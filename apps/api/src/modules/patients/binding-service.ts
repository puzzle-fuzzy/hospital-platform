import type { PatientBindingPayload } from "@hospital/contracts";
import {
	type AdapterCallContext,
	adapterContextTraceId,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	type PatientBindingGateway,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type { PatientService } from "./service";

type PatientBindingInput = {
	displayName: string;
	mobile: string;
	identityNumber: string;
	consent: true;
};

export class PatientBindingInputError extends Error {
	constructor() {
		super("Patient binding input is invalid");
		this.name = "PatientBindingInputError";
	}
}

function isSafeText(value: unknown, maxLength: number): value is string {
	return (
		typeof value === "string" &&
		value === value.trim() &&
		Array.from(value).length > 0 &&
		Array.from(value).length <= maxLength &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function parseIdentityNumber(value: string): {
	birthDate: string;
	sex: "1" | "2";
} {
	const normalized = value.toUpperCase();
	if (!/^(?:\d{15}|\d{17}[0-9X])$/u.test(normalized)) {
		throw new PatientBindingInputError();
	}
	if (normalized.length === 18) {
		const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
		const checks = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
		const checksum = weights.reduce(
			(total, weight, index) => total + Number(normalized[index]) * weight,
			0,
		);
		if (checks[checksum % 11] !== normalized[17]) {
			throw new PatientBindingInputError();
		}
	}
	const isEighteenDigit = normalized.length === 18;
	const year = isEighteenDigit
		? normalized.slice(6, 10)
		: `19${normalized.slice(6, 8)}`;
	const month = normalized.slice(
		isEighteenDigit ? 10 : 8,
		isEighteenDigit ? 12 : 10,
	);
	const day = normalized.slice(
		isEighteenDigit ? 12 : 10,
		isEighteenDigit ? 14 : 12,
	);
	const birthDate = `${year}-${month}-${day}`;
	const parsed = new Date(`${birthDate}T00:00:00.000Z`);
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== birthDate ||
		parsed > new Date()
	) {
		throw new PatientBindingInputError();
	}
	const sexIndex = Number(normalized.charAt(isEighteenDigit ? 16 : 14));
	if (!Number.isInteger(sexIndex)) throw new PatientBindingInputError();
	return { birthDate, sex: sexIndex % 2 === 1 ? "1" : "2" };
}

function normalizeInput(value: unknown): PatientBindingInput & {
	birthDate: string;
	sex: "1" | "2";
} {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new PatientBindingInputError();
	}
	const input = value as Record<string, unknown>;
	if (
		Object.keys(input).some(
			(key) =>
				key !== "displayName" &&
				key !== "mobile" &&
				key !== "identityNumber" &&
				key !== "consent",
		) ||
		!isSafeText(input.displayName, 128) ||
		!isSafeText(input.mobile, 11) ||
		!/^1[3-9]\d{9}$/u.test(input.mobile) ||
		!isSafeText(input.identityNumber, 18) ||
		input.consent !== true
	) {
		throw new PatientBindingInputError();
	}
	return {
		...requestFields(input),
		...parseIdentityNumber(input.identityNumber),
	};
}

function requestFields(input: Record<string, unknown>): PatientBindingInput {
	return {
		displayName: input.displayName as string,
		mobile: input.mobile as string,
		identityNumber: (input.identityNumber as string).toUpperCase(),
		consent: true,
	};
}

function requireOwner(value: unknown): string {
	if (!isBoundedOpaqueIdentifier(value)) throw new PatientBindingInputError();
	return value;
}

function requireContext(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context) throw new PatientBindingInputError();
	return context;
}

export type PatientBindingServiceDependencies = {
	patients: PatientService;
	gateway: PatientBindingGateway;
	logger?: AppLogger;
};

/**
 * 同一进程内按 owner 与幂等键合并重复点击；跨进程和重启后的安全性仍由
 * Provider 幂等键及“先查档、再建档、后绑卡”顺序共同保证。
 */
const inFlightBindings = new Map<
	string,
	{ fingerprint: string; promise: Promise<PatientBindingPayload["data"]> }
>();

function syncContextForBinding(
	context: AdapterCallContext,
): AdapterCallContext {
	// 患者同步拥有独立的 durable operation ledger；不能把绑定命令的幂等键
	// 直接复用，否则一次旧的 sync replay 可能跳过建档后的新目录读取。
	return {
		...context,
		idempotencyKey: `binding-sync-${context.idempotencyKey}`.slice(0, 128),
	};
}

export class PatientBindingService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: PatientBindingServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async bind(
		ownerUserId: string,
		input: unknown,
		context: AdapterCallContext,
	): Promise<PatientBindingPayload["data"]> {
		const owner = requireOwner(ownerUserId);
		const request = normalizeInput(input);
		const traceContext = requireContext(context);
		const key = `${owner}:${traceContext.idempotencyKey}`;
		const fingerprint = JSON.stringify(request);
		const active = inFlightBindings.get(key);
		if (active) {
			if (active.fingerprint !== fingerprint) {
				throw new PatientBindingInputError();
			}
			return active.promise;
		}

		const operation = (async () => {
			try {
				const result = await this.dependencies.gateway.bind(
					request,
					traceContext,
				);
				const directory = await this.dependencies.patients.sync(
					owner,
					syncContextForBinding(traceContext),
				);
				this.logger.info(
					{
						event: "patient.binding.completed",
						traceId: adapterContextTraceId(traceContext),
						created: result.created,
						itemCount: directory.total,
					},
					"Patient binding completed",
				);
				return { created: result.created, ...directory };
			} catch (error) {
				this.logger.error(
					{
						event: "patient.binding.failed",
						traceId: adapterContextTraceId(traceContext),
						errorType: error instanceof Error ? error.name : "unknown",
					},
					"Patient binding failed",
				);
				throw error;
			}
		})();
		inFlightBindings.set(key, { fingerprint, promise: operation });
		try {
			return await operation;
		} finally {
			inFlightBindings.delete(key);
		}
	}
}
