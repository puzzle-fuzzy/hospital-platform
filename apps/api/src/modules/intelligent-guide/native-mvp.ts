import { MvpIntelligentGuideModel } from "@hospital/ai-runtime";
import type { IntelligentGuideMessageRequestPayload } from "@hospital/contracts";
import type {
	AdapterCallContext,
	AppointmentDirectoryGateway,
	IntelligentGuideApplicationService,
	IntelligentGuideConversationMessage,
	IntelligentGuideConversationStateStore,
	IntelligentGuideModelGateway,
	IntelligentGuideSpeechGateway,
} from "@hospital/domain";
import {
	adapterContextTraceId,
	DependencyNotConfiguredError,
	INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES,
	INTELLIGENT_GUIDE_AUDIO_MAX_BYTES,
	INTELLIGENT_GUIDE_AUDIO_MIN_BYTES,
	INTELLIGENT_GUIDE_CONVERSATION_TTL_SECONDS,
	INTELLIGENT_GUIDE_HISTORY_MAX_MESSAGES,
	INTELLIGENT_GUIDE_MESSAGE_MAX_CODE_POINTS,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	normalizeAppointmentDepartmentResults,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import {
	IntelligentGuideConversationExpiredError,
	IntelligentGuideInputError,
} from "./service";

const MAX_MODEL_DEPARTMENT_CANDIDATES = 20;
const MAX_MODEL_MESSAGE_LENGTH = 4_000;
const GUIDE_DIRECTORY_RANGE_DAYS = 30;
const CONVERSATION_REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const GUIDE_DISCLAIMER =
	"就医助手仅用于推荐可能合适的门诊科室，不能替代医生诊断；如有急危重症，请立即就医或拨打 120。";

function safeContext(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context) throw new IntelligentGuideInputError();
	return context;
}

function shanghaiDate(now: Date, offsetDays: number): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const values = Object.fromEntries(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, Number(part.value)]),
	) as Record<string, number>;
	const year = values.year ?? Number.NaN;
	const month = values.month ?? Number.NaN;
	const day = values.day ?? Number.NaN;
	if (
		!Number.isSafeInteger(year) ||
		!Number.isSafeInteger(month) ||
		!Number.isSafeInteger(day)
	) {
		throw new Error("Shanghai calendar date is unavailable");
	}
	const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
	return date.toISOString().slice(0, 10);
}

function normalizeSearchText(value: string): string {
	return value
		.normalize("NFKC")
		.replaceAll(/\s+/gu, "")
		.toLocaleLowerCase("zh-CN")
		.replace(/门诊$/u, "");
}

function isClinicalGuideDepartment(displayName: string): boolean {
	const name = normalizeSearchText(displayName);
	return !name.includes("测试") && name !== "门诊治疗室";
}

// 只允许医疗范围等价的常见名称，不把“内科”等大类扩展到任意专科。
const DEPARTMENT_ALIAS_GROUPS: readonly (readonly string[])[] = [
	["心内科", "心血管内科"],
	["呼吸内科", "呼吸科", "呼吸与危重症医学科", "呼吸与危重症医学"],
	["消化内科", "消化科"],
	["普外科", "普通外科"],
	["耳鼻喉科", "耳鼻咽喉科"],
	["口腔科", "牙科"],
	["全科", "全科医学科"],
];

function resolveDepartments(
	departments: readonly { departmentId: string; displayName: string }[],
	candidates: readonly string[],
) {
	const resolved = [] as { departmentId: string; displayName: string }[];
	let hasUnresolvedCandidates = false;
	for (const candidate of candidates) {
		const expected = normalizeSearchText(candidate);
		const exactMatches = departments.filter(
			(department) => normalizeSearchText(department.displayName) === expected,
		);
		const aliases = DEPARTMENT_ALIAS_GROUPS.find((group) =>
			group.includes(expected),
		);
		const matches =
			exactMatches.length > 0
				? exactMatches
				: aliases
					? departments.filter((department) =>
							aliases.includes(normalizeSearchText(department.displayName)),
						)
					: [];
		// 模型只返回名称，无法在同名或别名多义的多个挂号入口中安全选 ID。
		const match = matches.length === 1 ? matches[0] : undefined;
		if (!match) hasUnresolvedCandidates = true;
		if (
			match &&
			resolved.length < 3 &&
			!resolved.some((item) => item.departmentId === match.departmentId)
		) {
			resolved.push(match);
		}
	}
	return { departments: resolved, hasUnresolvedCandidates };
}

export type NativeIntelligentGuideServiceDependencies = {
	directory: AppointmentDirectoryGateway;
	conversations: IntelligentGuideConversationStateStore;
	model?: IntelligentGuideModelGateway;
	speech?: IntelligentGuideSpeechGateway;
	logger?: AppLogger;
	now?: () => Date;
};

function requireOwner(ownerUserId: string): string {
	if (!isBoundedOpaqueIdentifier(ownerUserId))
		throw new IntelligentGuideInputError();
	return ownerUserId;
}

function requireReference(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "string" ||
		!isBoundedOpaqueIdentifier(value) ||
		!CONVERSATION_REFERENCE_PATTERN.test(value)
	) {
		throw new IntelligentGuideInputError();
	}
	return value;
}

function requireMessage(value: unknown): string {
	if (typeof value !== "string") throw new IntelligentGuideInputError();
	const message = value.trim();
	if (
		!message ||
		Array.from(message).length > INTELLIGENT_GUIDE_MESSAGE_MAX_CODE_POINTS ||
		Array.from(message).some((character) => {
			const code = character.charCodeAt(0);
			return (code <= 0x1f && code !== 0x0a && code !== 0x0d) || code === 0x7f;
		})
	) {
		throw new IntelligentGuideInputError();
	}
	return message;
}

function hasControlCharacter(value: string, allowLineBreaks = false): boolean {
	return Array.from(value).some((character) => {
		const code = character.charCodeAt(0);
		if (allowLineBreaks && (code === 0x0a || code === 0x0d)) return false;
		return code <= 0x1f || code === 0x7f;
	});
}

function normalizeModelReply(value: unknown): {
	message: string;
	departmentNames: readonly string[];
	urgent: boolean;
} {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new DependencyNotConfiguredError("intelligent-guide-model");
	}
	const reply = value as Record<string, unknown>;
	const message = reply.message;
	const departmentNames = reply.departmentNames;
	const urgent = reply.urgent;
	if (
		typeof message !== "string" ||
		!message.trim() ||
		message.length > MAX_MODEL_MESSAGE_LENGTH ||
		hasControlCharacter(message, true) ||
		(urgent !== undefined && typeof urgent !== "boolean") ||
		!Array.isArray(departmentNames) ||
		departmentNames.length > MAX_MODEL_DEPARTMENT_CANDIDATES
	) {
		throw new DependencyNotConfiguredError("intelligent-guide-model");
	}

	const normalizedNames = departmentNames.map((name) => {
		if (
			typeof name !== "string" ||
			!name.trim() ||
			Array.from(name).length > 128 ||
			hasControlCharacter(name)
		) {
			throw new DependencyNotConfiguredError("intelligent-guide-model");
		}
		return name.trim();
	});

	return {
		message: message.trim(),
		departmentNames: normalizedNames,
		urgent: urgent === true,
	};
}

export class NativeIntelligentGuideService
	implements IntelligentGuideApplicationService
{
	private readonly logger: AppLogger;
	private readonly model: IntelligentGuideModelGateway;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: NativeIntelligentGuideServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.model = dependencies.model ?? new MvpIntelligentGuideModel();
		this.now = dependencies.now ?? (() => new Date());
	}

	private async loadHistory(
		owner: string,
		reference: string | undefined,
	): Promise<IntelligentGuideConversationMessage[]> {
		if (!reference) return [];
		const state = await this.dependencies.conversations.load({
			ownerUserId: owner,
			conversationReference: reference,
		});
		if (!state) throw new IntelligentGuideConversationExpiredError();
		return [...state.messages];
	}

	async chatText(
		ownerUserId: string,
		input: IntelligentGuideMessageRequestPayload,
		context: AdapterCallContext,
	): Promise<{
		conversationReference: string;
		progress: number;
		message?: string;
		userInput?: string;
		departments: { departmentId: string; displayName: string }[];
		advice?: string;
		summary?: string;
		disclaimer: string;
	}> {
		const owner = requireOwner(ownerUserId);
		const traceContext = safeContext(context);
		const message = requireMessage(input.message);
		const reference = requireReference(input.conversationReference);
		const history = (await this.loadHistory(owner, reference)).slice(
			-(INTELLIGENT_GUIDE_HISTORY_MAX_MESSAGES - 2),
		);
		const turns = history.filter((item) => item.role === "user").length + 1;
		const directory = await this.dependencies.directory.listDepartments(
			{
				startDate: shanghaiDate(this.now(), 0),
				endDate: shanghaiDate(this.now(), GUIDE_DIRECTORY_RANGE_DAYS),
			},
			traceContext,
		);
		const availableDepartments = normalizeAppointmentDepartmentResults(
			directory.departments,
		)
			.filter(({ displayName }) => isClinicalGuideDepartment(displayName))
			.map(({ departmentId, displayName }) => ({ departmentId, displayName }));

		const modelReply = normalizeModelReply(
			await this.model.complete(
				{ message, history, availableDepartments },
				traceContext,
			),
		);
		const { departments, hasUnresolvedCandidates } = modelReply.urgent
			? { departments: [], hasUnresolvedCandidates: false }
			: resolveDepartments(availableDepartments, modelReply.departmentNames);

		const messageText = modelReply.urgent
			? "根据您描述的情况，请立即前往急诊或拨打120，不要等待普通门诊挂号。"
			: modelReply.departmentNames.length > 0 && departments.length === 0
				? "当前本院可预约目录中未找到能够确认的匹配科室，建议联系门诊导诊台或人工挂号窗口协助选择。若症状明显加重或出现急危重症，请立即就医或拨打 120。"
				: hasUnresolvedCandidates
					? "根据您的描述，可优先考虑以下本院可预约科室；其他科室暂未在当前目录中确认，可联系门诊导诊台进一步核实。"
					: modelReply.message;
		const nextHistory: IntelligentGuideConversationMessage[] = [
			...history,
			{ role: "user", content: message },
			{ role: "assistant", content: messageText },
		];
		const conversationReference = reference ?? crypto.randomUUID();
		await this.dependencies.conversations.save({
			ownerUserId: owner,
			conversationReference,
			state: { messages: nextHistory },
			expiresInSeconds: INTELLIGENT_GUIDE_CONVERSATION_TTL_SECONDS,
		});

		this.logger.info(
			{
				event: "intelligent-guide.native-mvp.completed",
				traceId: adapterContextTraceId(traceContext),
				userId: owner,
				turns,
				progress: departments.length > 0 ? 100 : 0,
				departmentCount: departments.length,
			},
			"Native TS intelligent guide MVP completed",
		);

		return {
			conversationReference,
			progress: departments.length > 0 ? 100 : 0,
			message: messageText,
			departments,
			disclaimer: GUIDE_DISCLAIMER,
		};
	}

	async chatAudio(
		ownerUserId: string,
		input: {
			legacyLoginCode?: string;
			audio: Uint8Array;
			contentType: string;
			conversationReference?: string;
		},
		context: AdapterCallContext,
	): Promise<{
		conversationReference: string;
		progress: number;
		message?: string;
		userInput?: string;
		departments: { departmentId: string; displayName: string }[];
		advice?: string;
		summary?: string;
		disclaimer: string;
	}> {
		const owner = requireOwner(ownerUserId);
		const traceContext = safeContext(context);
		if (
			!(input.audio instanceof Uint8Array) ||
			input.audio.byteLength < INTELLIGENT_GUIDE_AUDIO_MIN_BYTES ||
			input.audio.byteLength > INTELLIGENT_GUIDE_AUDIO_MAX_BYTES ||
			typeof input.contentType !== "string" ||
			!INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES.includes(
				input.contentType as (typeof INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES)[number],
			)
		) {
			throw new IntelligentGuideInputError();
		}
		if (!this.dependencies.speech) {
			throw new DependencyNotConfiguredError("intelligent-guide-audio");
		}
		const transcription = await this.dependencies.speech.transcribe(
			{
				audio: input.audio,
				contentType:
					input.contentType as (typeof INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES)[number],
			},
			traceContext,
		);
		const message = requireMessage(transcription.text);
		const reply = await this.chatText(
			owner,
			{
				message,
				...(input.conversationReference
					? { conversationReference: input.conversationReference }
					: {}),
			},
			traceContext,
		);
		return { ...reply, userInput: message };
	}
}
