import type {
	AdapterCallContext,
	ExternalTrace,
	PatientDirectoryGateway,
	PatientDirectoryProfile,
	PatientRelationship,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";

const PATIENT_INFO_BY_UNION_ID_PATH = "/api/public/patientInfoByUnionId";
const PATIENT_ARCHIVE_PATH = "/msun-middle-aggregate-patient/v1/patInfosFind";

type ZhongyangPatientResponse = {
	thirdPatientId?: unknown;
	patientName?: unknown;
	cardNo?: unknown;
	medicalCardNo?: unknown;
	relation?: unknown;
};

type ZhongyangPatientEnvelope = {
	success?: unknown;
	data?: unknown;
	message?: unknown;
};

/** 众阳各服务共用的服务端连接配置；业务 adapter 不共享彼此的模型。 */
export type ZhongyangGatewayOptions = {
	/** 众阳服务端地址；不能来自小程序请求参数。 */
	baseUrl: string;
	/** 只有 provider 明确要求时才注入服务端 token，绝不从客户端透传。 */
	authorizationToken?: string;
	fetcher?: ProviderFetcher;
};

export type ZhongyangPatientGatewayOptions = ZhongyangGatewayOptions;

function requiredConfig(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new AdapterNotConfiguredError("zhongyang");
	return normalized;
}

/**
 * 患者目录字段会进入查询 URL、内部映射和页面展示，不能只依赖 URL 编码或
 * 数据库转义兜底。控制字符可能破坏日志检索、页面排版和后续引用边界；这里
 * 选择拒绝整次 Provider 快照，而不是静默删除字符，避免把错误患者资料改写成
 * 看似合法的另一条患者事实。
 */
function containsControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const code = character.charCodeAt(0);
		return code <= 0x1f || code === 0x7f;
	});
}

function providerError(
	message: string,
	requestId?: string,
	operation = "patient-list",
	responseInvalid = false,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation,
		message,
		retryable: false,
		responseInvalid,
		...(requestId ? { requestId } : {}),
	});
}

function requiredText(
	value: unknown,
	field: string,
	maxLength: number,
	operation = "patient-list",
	requestId?: string,
	responseInvalid = false,
): string {
	// Provider 的 JSON 数字会先被 JavaScript 解析成 Number；超过
	// `Number.MAX_SAFE_INTEGER` 后，原始 19 位 patId 已经发生不可逆精度
	// 损失，再调用 String(value) 也无法恢复真实临床档案。安全整数仍允许
	// 兼容少数旧接口返回的短数字 thirdPatientId，但不接受 NaN、Infinity、
	// 小数或超出安全范围的数字，避免把错误引用写入后续患者映射。
	if (
		(typeof value !== "string" && typeof value !== "number") ||
		(typeof value === "number" && !Number.isSafeInteger(value))
	) {
		throw providerError(
			`Zhongyang patient field ${field} is invalid`,
			requestId,
			operation,
			responseInvalid,
		);
	}
	const normalized = String(value).trim();
	if (
		!normalized ||
		normalized.length > maxLength ||
		containsControlCharacter(normalized)
	) {
		throw providerError(
			`Zhongyang patient field ${field} is invalid`,
			requestId,
			operation,
			responseInvalid,
		);
	}
	return normalized;
}

/**
 * 卡号必须保持 Provider 原始字符串形态。
 *
 * 与允许安全整数的普通外部 ID 不同，卡号可能有前导零；一旦 JSON 把
 * `001000...` 编码成 Number，JavaScript 即使没有发生精度溢出，也已经
 * 无法恢复原卡号。身份查询宁可 fail-closed，也不能用被改写的卡号查档案。
 */
function requiredCardText(
	value: unknown,
	field: string,
	operation: string,
	requestId: string,
	responseInvalid = false,
): string {
	if (typeof value !== "string") {
		throw providerError(
			`Zhongyang patient field ${field} is invalid`,
			requestId,
			operation,
			responseInvalid,
		);
	}
	return requiredText(value, field, 128, operation, requestId, responseInvalid);
}

function maskCardNumber(value: unknown): string {
	if (value === undefined || value === null) return "未绑定";
	const normalized = String(value).trim();
	if (!normalized || normalized.length > 64) return "未绑定";
	if (normalized.length <= 4) return "*".repeat(normalized.length);
	// 患者选择页需要可核对卡号，但不能暴露完整卡号：最多展示前五位和后四位。
	const suffixLength = Math.min(4, normalized.length);
	const prefixLength = Math.min(
		5,
		Math.max(0, normalized.length - suffixLength - 1),
	);
	const maskLength = normalized.length - prefixLength - suffixLength;
	return `${normalized.slice(0, prefixLength)}${"*".repeat(maskLength)}${normalized.slice(-suffixLength)}`;
}

/** 按 provider 旧端约定选择第一个非空卡号，空字符串不能遮蔽有效兜底值。 */
function firstNonBlank(...values: unknown[]): unknown {
	return values.find(
		(value) =>
			(typeof value === "string" || typeof value === "number") &&
			String(value).trim().length > 0,
	);
}

/**
 * Provider 数组中的每一项必须是普通对象。
 *
 * 只把整个数组断言成 `ZhongyangPatientResponse[]` 会掩盖 `null`、字符串或
 * 嵌套数组等非法响应；后续读取 `thirdPatientId` 时会变成原生 TypeError，
 * 既丢失 `provider-response-invalid` 语义，也无法稳定保留 Provider requestId。
 */
function isPatientRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relationship(value: unknown): PatientRelationship {
	const normalized =
		typeof value === "string" ? value.trim().toLowerCase() : "";
	const aliases: Record<string, PatientRelationship> = {
		self: "self",
		本人: "self",
		spouse: "spouse",
		配偶: "spouse",
		child: "child",
		子女: "child",
		parent: "parent",
		父母: "parent",
	};
	return aliases[normalized] ?? "other";
}

function responseItems(
	value: unknown,
	requestId: string,
): ZhongyangPatientResponse[] {
	let items: unknown[];
	if (Array.isArray(value)) {
		items = value;
	} else if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value)
	) {
		throw providerError(
			"Zhongyang patient response data was invalid",
			requestId,
			"patient-list",
			true,
		);
	} else {
		const envelope = value as ZhongyangPatientEnvelope;
		if (envelope.success === false) {
			throw providerError(
				"Zhongyang patient provider rejected the request",
				requestId,
			);
		}
		// 患者目录的包络必须明确 success=true；缺少成功标志时不能把
		// `{ data: [] }` 当成“没有就诊人”，否则会触发错误的空目录/失效语义。
		if (envelope.success !== true) {
			throw providerError(
				"Zhongyang patient response success flag was invalid",
				requestId,
				"patient-list",
				true,
			);
		}
		if (!Array.isArray(envelope.data)) {
			throw providerError(
				"Zhongyang patient response data was invalid",
				requestId,
			);
		}
		items = envelope.data;
	}
	if (!items.every(isPatientRecord)) {
		// 必须在任何字段访问和档案查询之前拒绝整批，保证坏元素不会让
		// 有效患者先产生 patInfosFind 副作用，也不会被当成内部异常。
		throw providerError(
			"Zhongyang patient response contained an invalid item",
			requestId,
			"patient-list",
			true,
		);
	}
	return items as ZhongyangPatientResponse[];
}

/**
 * 拒绝同一完整目录中的重复 provider 患者号。
 *
 * 后续持久化以 providerPatientId 作为 owner/provider 下的稳定匹配键；如果
 * 这里放过重复值，多个 provider 对象会在 upsert 时合并成一条记录，最后一条
 * 资料可能静默覆盖姓名、关系、卡号或 HIS 映射。这个结果既无法判断哪一条
 * 是权威事实，也不能安全触发目录失效回收，所以必须把整个快照判为非法。
 */
function ensureUniqueProviderPatientIds(
	items: readonly ZhongyangPatientResponse[],
	requestId: string,
): void {
	const seen = new Set<string>();
	for (const item of items) {
		const providerPatientId = requiredText(
			item.thirdPatientId,
			"thirdPatientId",
			128,
			"patient-list",
			requestId,
			true,
		);
		if (seen.has(providerPatientId)) {
			throw providerError(
				"Zhongyang patient response contained duplicate patient ids",
				requestId,
				"patient-list",
				true,
			);
		}
		seen.add(providerPatientId);
	}
}

/**
 * 拒绝不同目录患者共享同一个临床档案引用。
 *
 * 目录患者和 HIS 档案是两层标识，正常情况下应当是一对一映射；如果两个
 * 目录对象共用一个 `patId`，后续预约、报告或费用查询可能在用户切换患者后
 * 读取同一份临床数据。无法确认 provider 的真实归并语义时，宁可整次同步失败，
 * 也不能把潜在的错患者数据当成可用映射写入平台。
 */
function ensureUniqueHisPatientIds(
	patients: readonly PatientDirectoryProfile[],
	requestId: string,
): void {
	const seen = new Set<string>();
	for (const patient of patients) {
		const hisPatientId = patient.providerReferences?.["his-patient"];
		if (!hisPatientId) {
			throw providerError(
				"Zhongyang patient response did not contain a HIS patient reference",
				requestId,
				"patient-list",
				true,
			);
		}
		if (seen.has(hisPatientId)) {
			throw providerError(
				"Zhongyang patient response contained duplicate HIS patient references",
				requestId,
				"patient-list",
				true,
			);
		}
		seen.add(hisPatientId);
	}
}

function mapPatient(
	value: ZhongyangPatientResponse,
	requestId: string,
): PatientDirectoryProfile {
	const providerPatientId = requiredText(
		value.thirdPatientId,
		"thirdPatientId",
		128,
		"patient-list",
		requestId,
		true,
	);
	const displayName = requiredText(
		value.patientName,
		"patientName",
		128,
		"patient-list",
		requestId,
		true,
	);
	// 旧端患者选择流程明确优先 medicalCardNo；cardNo 只作为旧数据兜底。
	const card = requiredCardText(
		firstNonBlank(value.medicalCardNo, value.cardNo),
		"medicalCardNo",
		"patient-archive",
		requestId,
		true,
	);
	return {
		providerPatientId,
		displayName,
		relationship: relationship(value.relation),
		cardNumberMasked: maskCardNumber(card),
	};
}

const ARCHIVE_CARD_FIELDS = [
	"cardNo",
	"medicalCardNo",
	"idCardNo",
	"idcardNo",
] as const;

const ARCHIVE_PATIENT_CARD_FIELDS = [
	"patCardNo",
	"cardPatCardNo",
	"originalPatCardNo",
	"idcardNo",
] as const;

/**
 * 读取档案响应中的可选身份字段，但不把它们带出 adapter。
 *
 * 目前已确认的最小 Provider 契约只有 `success=true` 和字符串 `patId`；
 * 不同环境可能省略姓名或卡片列表，所以缺少字段仍保持兼容。可是只要
 * Provider 返回了这些字段，就必须先校验格式，不能让错误的患者资料静默
 * 参与 HIS 映射。普通档案字段沿用 `requiredText` 的安全整数边界；卡号
 * 字段另走 `optionalArchiveCardText`，禁止 JSON 数字破坏前导零。
 */
function optionalArchiveText(
	value: unknown,
	field: string,
	requestId: string,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	return requiredText(value, field, 128, "patient-archive", requestId, true);
}

/** 档案响应中的卡号也必须保持字符串，不能接受丢失前导零的 JSON 数字。 */
function optionalArchiveCardText(
	value: unknown,
	field: string,
	requestId: string,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	return requiredCardText(value, field, "patient-archive", requestId, true);
}

/**
 * 将档案查询结果与本次目录患者做二次身份关联。
 *
 * `patInfosFind` 是按姓名和卡号查询的，但只检查返回 `patId` 仍不足以
 * 证明 Provider 没有返回同名患者或错误卡片。正式契约尚未冻结时，不能
 * 贸然要求所有环境都返回完整字段；因此采用“有字段必匹配、无字段保持
 * 最小兼容”的边界。发现不匹配时整次同步失败，绝不把错误 HIS `patId`
 * 写入当前患者的 owner-scoped 映射。
 */
function ensureArchiveMatchesQuery(
	archive: Record<string, unknown>,
	archivePatientId: string,
	requestedCard: string,
	requestedName: string,
	requestId: string,
): void {
	const returnedName = optionalArchiveText(
		archive.patName,
		"patName",
		requestId,
	);
	if (returnedName !== undefined && returnedName !== requestedName) {
		throw providerError(
			"Zhongyang patient archive did not match requested patient",
			requestId,
			"patient-archive",
			true,
		);
	}

	const returnedTopLevelCards = new Set<string>();
	for (const field of ARCHIVE_CARD_FIELDS) {
		const card = optionalArchiveCardText(archive[field], field, requestId);
		if (card !== undefined) returnedTopLevelCards.add(card);
	}

	const patientCards = archive.patCardVOList;
	// `undefined/null` 表示 Provider 没有给出卡片列表，继续保留最小兼容；
	// 但只要明确返回数组（包括空数组），它就成为本次档案身份关联的一部分。
	// 空数组或只有无卡号字段的数组不能证明查询卡号属于该档案，必须拒绝，
	// 不能因为顶层仍有一个合法格式的 patId 就放行错误临床映射。
	if (patientCards !== undefined && patientCards !== null) {
		if (!Array.isArray(patientCards)) {
			throw providerError(
				"Zhongyang patient archive card list was invalid",
				requestId,
				"patient-archive",
				true,
			);
		}
		const returnedCardListCards = new Set<string>();
		for (const [index, item] of patientCards.entries()) {
			if (typeof item !== "object" || item === null || Array.isArray(item)) {
				throw providerError(
					"Zhongyang patient archive card item was invalid",
					requestId,
					"patient-archive",
					true,
				);
			}
			const cardItem = item as Record<string, unknown>;
			const cardPatientId = optionalArchiveText(
				cardItem.patId,
				`patCardVOList[${index}].patId`,
				requestId,
			);
			if (cardPatientId !== undefined && cardPatientId !== archivePatientId) {
				throw providerError(
					"Zhongyang patient archive card owner did not match archive",
					requestId,
					"patient-archive",
					true,
				);
			}
			for (const field of ARCHIVE_PATIENT_CARD_FIELDS) {
				const card = optionalArchiveCardText(
					cardItem[field],
					`patCardVOList[${index}].${field}`,
					requestId,
				);
				if (card !== undefined) returnedCardListCards.add(card);
			}
		}
		// Provider 明确返回卡片数组后，数组本身才是卡片归属证据：空数组、
		// 没有任何可比较卡号的数组，或数组不包含本次查询卡号，都必须拒绝。
		// 不能让顶层 cardNo 与卡片数组做并集，否则“顶层匹配但卡片列表
		// 为空/指向另一张卡”的错误档案会被误写成有效 HIS 映射。
		if (
			returnedCardListCards.size === 0 ||
			!returnedCardListCards.has(requestedCard)
		) {
			throw providerError(
				"Zhongyang patient archive did not match requested card",
				requestId,
				"patient-archive",
				true,
			);
		}
	} else if (
		returnedTopLevelCards.size > 0 &&
		!returnedTopLevelCards.has(requestedCard)
	) {
		// Provider 未返回卡片数组时，才使用顶层卡号做最小兼容校验。
		throw providerError(
			"Zhongyang patient archive did not match requested card",
			requestId,
			"patient-archive",
			true,
		);
	}
}

/**
 * 使用旧端已经验证过的档案查询契约取得临床业务所需的 HIS patId。
 *
 * patientInfoByUnionId 返回的 thirdPatientId 是患者目录引用，不能直接
 * 拼到 appointment-infos、报告或门诊费用接口。这里通过卡号+姓名查询
 * patInfosFind，只把返回的 patId 留在服务端映射层，不进入小程序响应。
 */
async function resolveHisPatientId(
	value: ZhongyangPatientResponse,
	context: AdapterCallContext,
	fetcher: ProviderFetcher,
	baseUrl: string,
	authorizationToken: string | undefined,
	requestId: string,
): Promise<string> {
	const operation = "patient-archive";
	const card = requiredCardText(
		firstNonBlank(value.medicalCardNo, value.cardNo),
		"medicalCardNo",
		operation,
		requestId,
		true,
	);
	const displayName = requiredText(
		value.patientName,
		"patientName",
		128,
		operation,
		requestId,
		true,
	);
	const url = new URL(PATIENT_ARCHIVE_PATH, baseUrl);
	url.searchParams.set("type", "3");
	url.searchParams.set("cardNo", card);
	url.searchParams.set("patName", displayName);
	const response = await requestJson<unknown>(
		{
			provider: "zhongyang",
			operation,
			url: url.toString(),
			method: "GET",
			context,
			...(authorizationToken
				? { headers: { Authorization: `Bearer ${authorizationToken}` } }
				: {}),
		},
		fetcher,
	);
	if (
		typeof response.data !== "object" ||
		response.data === null ||
		Array.isArray(response.data)
	) {
		throw providerError(
			"Zhongyang patient archive response was invalid",
			response.requestId,
			operation,
			true,
		);
	}
	const envelope = response.data as ZhongyangPatientEnvelope;
	if (envelope.success === false) {
		throw providerError(
			"Zhongyang patient archive provider rejected the request",
			response.requestId,
			operation,
		);
	}
	if (envelope.success !== true) {
		// 档案接口的 patId 是预约、报告和门诊费用共用的临床映射；
		// 缺少明确成功标志时必须停止，不能把不完整响应解释成“无档案”。
		throw providerError(
			"Zhongyang patient archive success flag was invalid",
			response.requestId,
			operation,
			true,
		);
	}
	if (
		typeof envelope.data !== "object" ||
		envelope.data === null ||
		Array.isArray(envelope.data)
	) {
		throw providerError(
			"Zhongyang patient archive data was invalid",
			response.requestId,
			operation,
			true,
		);
	}
	const archive = envelope.data as Record<string, unknown>;
	const archivePatientId = requiredText(
		archive.patId,
		"patId",
		128,
		operation,
		response.requestId,
		true,
	);
	ensureArchiveMatchesQuery(
		archive,
		archivePatientId,
		card,
		displayName,
		response.requestId,
	);
	return archivePatientId;
}

function trace(requestId: string): ExternalTrace {
	return {
		provider: "zhongyang",
		operation: "patient-list",
		requestId,
	};
}

/**
 * 众阳患者目录 adapter。
 *
 * 旧小程序曾直接调用 `/api/public/patientInfoByUnionId`；新架构只允许服务端
 * 使用已绑定的 unionId 调用，并将 provider 原始患者结构收窄为最小脱敏事实。
 */
export class ZhongyangPatientApiGateway implements PatientDirectoryGateway {
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangPatientGatewayOptions) {
		this.baseUrl = requiredConfig(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	async listByIdentity(
		input: { unionId: string },
		context: AdapterCallContext,
	): Promise<{
		complete: true;
		patients: readonly PatientDirectoryProfile[];
		trace: ExternalTrace;
	}> {
		const unionId = requiredText(input.unionId, "unionId", 128);
		const url = new URL(PATIENT_INFO_BY_UNION_ID_PATH, this.baseUrl);
		url.searchParams.set("unionId", unionId);
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "patient-list",
				url: url.toString(),
				method: "GET",
				context,
				...(this.authorizationToken
					? { headers: { Authorization: `Bearer ${this.authorizationToken}` } }
					: {}),
			},
			this.fetcher,
		);
		const items = responseItems(response.data, response.requestId);
		// 先验证整个目录的主键唯一性，再访问每个患者的档案接口；否则
		// 重复数据会造成额外 provider 请求，并在持久化层发生不确定覆盖。
		ensureUniqueProviderPatientIds(items, response.requestId);
		// 先把整个目录映射成平台最小字段；只有所有患者的目录字段和档案查询
		// 必要输入都通过结构校验后，才允许任何一条进入 patInfosFind。否则
		// 第二位患者的坏数据可能让第一位患者先产生 Provider 副作用，最后才
		// 以整批失败结束，既浪费请求也让排障日志混入不完整的查询链。
		const mappedPatients = items.map((item) => ({
			item,
			patient: mapPatient(item, response.requestId),
		}));
		// 患者数量通常很少，完成整批预校验后再并行解析临床档案身份，避免把
		// thirdPatientId 错当成预约、报告和门诊费用接口的 patId。
		const patients = await Promise.all(
			mappedPatients.map(async ({ item, patient }) => {
				const hisPatientId = await resolveHisPatientId(
					item,
					context,
					this.fetcher,
					this.baseUrl,
					this.authorizationToken,
					response.requestId,
				);
				return {
					...patient,
					providerReferences: { "his-patient": hisPatientId },
				};
			}),
		);
		// provider 档案查询完成后再校验第二层标识的一对一关系；只有两层
		// 标识都没有重复，才允许把完整快照交给 service 和持久化层。
		ensureUniqueHisPatientIds(patients, response.requestId);
		return {
			// 当前 provider 响应没有分页游标；只有完整数组才可驱动目录失效回收。
			complete: true,
			patients,
			trace: trace(response.requestId),
		};
	}
}

export function createZhongyangPatientGateway(
	options: ZhongyangPatientGatewayOptions,
): PatientDirectoryGateway {
	return new ZhongyangPatientApiGateway(options);
}
