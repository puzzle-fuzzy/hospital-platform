import type { InpatientEpisodeListPayload } from "@hospital/contracts";
import type {
	AdapterCallContext,
	ExternalTrace,
	InpatientEpisodeGateway,
	PatientRepository,
} from "@hospital/domain";
import {
	adapterContextTraceId,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	normalizeExternalTrace,
	normalizeInpatientEpisodes,
	validateInpatientProviderReference,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";

export type InpatientEpisodeServiceDependencies = {
	repository: PatientRepository;
	directory: InpatientEpisodeGateway;
	logger?: AppLogger;
};

export class InpatientEpisodeQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InpatientEpisodeQueryError";
	}
}

export class InpatientEpisodePatientNotFoundError extends Error {
	constructor() {
		super("Inpatient episode patient is not available");
		this.name = "InpatientEpisodePatientNotFoundError";
	}
}

function requireContext(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context) {
		throw new InpatientEpisodeQueryError(
			"Inpatient episode context is invalid",
		);
	}
	return context;
}

function traceLogFields(trace: ExternalTrace) {
	return {
		providerRequestId: trace.requestId,
		...(trace.requestIds ? { providerRequestIds: [...trace.requestIds] } : {}),
	};
}

/**
 * 住院信息 service 只读旧服务的患者住院摘要；住院费用和支付不在这里
 * 建立入口。Provider 患者号必须先经过当前用户的 owner-scoped 引用解析。
 */
export class InpatientEpisodeService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: InpatientEpisodeServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async list(
		ownerUserId: string,
		patientId: string,
		context: AdapterCallContext,
	): Promise<InpatientEpisodeListPayload["data"]> {
		let trace: ExternalTrace | undefined;
		try {
			const normalizedContext = requireContext(context);
			if (
				!isBoundedOpaqueIdentifier(ownerUserId) ||
				!isBoundedOpaqueIdentifier(patientId)
			) {
				throw new InpatientEpisodeQueryError(
					"Inpatient episode owner or patient is invalid",
				);
			}
			this.logger.info(
				{
					event: "inpatient.episodes.requested",
					traceId: adapterContextTraceId(normalizedContext),
					provider: "zhongyang",
					patientId,
				},
				"Inpatient episodes requested",
			);

			const reference =
				await this.dependencies.repository.resolveProviderReference({
					ownerUserId,
					patientId,
					provider: "zhongyang",
					referenceKind: "his-patient",
				});
			if (!validateInpatientProviderReference(reference, patientId)) {
				throw new InpatientEpisodePatientNotFoundError();
			}
			const providerPatientId = (reference as { providerPatientId: string })
				.providerPatientId;

			const result = await this.dependencies.directory.listEpisodes(
				{ providerPatientId },
				normalizedContext,
			);
			trace = normalizeExternalTrace(result?.trace, {
				expectedProvider: "zhongyang",
			});
			const items = normalizeInpatientEpisodes(result?.episodes);
			this.logger.info(
				{
					event: "inpatient.episodes.loaded",
					traceId: adapterContextTraceId(normalizedContext),
					provider: trace.provider,
					...traceLogFields(trace),
					patientId,
					itemCount: items.length,
				},
				"Inpatient episodes loaded",
			);
			return { items, total: items.length };
		} catch (error) {
			this.logger.error(
				{
					event: "inpatient.episodes.failed",
					traceId: adapterContextTraceId(context),
					provider: "zhongyang",
					patientId: isBoundedOpaqueIdentifier(patientId)
						? patientId
						: "invalid",
					errorType: error instanceof Error ? error.name : "unknown",
					...providerFailureMetadata(error),
					...(trace ? traceLogFields(trace) : {}),
				},
				"Inpatient episodes request failed",
			);
			throw error;
		}
	}
}
