import {
	OutpatientPaymentListResponse,
	OutpatientPaymentStatusSchema,
	success,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	OutpatientPaymentGateway,
	OutpatientPaymentStatus,
	PatientRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import { Elysia, t } from "elysia";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import { requirePrincipal, type SessionTokenService } from "../auth/service";

export class OutpatientPaymentPatientNotFoundError extends Error {
	constructor() {
		super("Outpatient payment patient is not available");
		this.name = "OutpatientPaymentPatientNotFoundError";
	}
}

export type OutpatientPaymentServiceDependencies = {
	repository: PatientRepository;
	gateway: OutpatientPaymentGateway;
	authSysCode: string;
	logger?: AppLogger;
	now?: () => Date;
};

function providerDateTime(value: Date): string {
	const pad = (part: number) => String(part).padStart(2, "0");
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function queryWindow(now: Date): { startTime: string; endTime: string } {
	const start = new Date(now);
	start.setDate(start.getDate() - 30);
	return {
		startTime: providerDateTime(start),
		endTime: providerDateTime(now),
	};
}

/** 门诊缴费只读编排；provider 患者号只在 repository 与 adapter 之间流转。 */
export class OutpatientPaymentService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: OutpatientPaymentServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	async list(
		ownerUserId: string,
		patientId: string,
		status: OutpatientPaymentStatus,
		context: AdapterCallContext,
	) {
		const reference =
			await this.dependencies.repository.resolveProviderReference({
				ownerUserId,
				patientId,
				provider: "zhongyang",
				// 门诊费用接口的 patId 与预约/报告共用档案身份，不是目录 thirdPatientId。
				referenceKind: "his-patient",
			});
		if (!reference) throw new OutpatientPaymentPatientNotFoundError();

		const window = queryWindow(this.now());
		this.logger.info(
			{
				event: "outpatient.payment.records.requested",
				traceId: context.traceId,
				provider: "zhongyang",
				status,
				patientId,
				startTime: window.startTime,
				endTime: window.endTime,
			},
			"Outpatient payment records requested",
		);

		try {
			const result = await this.dependencies.gateway.listRecords(
				{
					providerPatientId: reference.providerPatientId,
					...window,
					status,
					authSysCode: this.dependencies.authSysCode,
				},
				context,
			);
			this.logger.info(
				{
					event: "outpatient.payment.records.loaded",
					traceId: context.traceId,
					provider: result.trace.provider,
					providerRequestId: result.trace.requestId,
					status,
					itemCount: result.records.length,
				},
				"Outpatient payment records loaded",
			);
			return {
				status,
				items: [...result.records],
				total: result.records.length,
			};
		} catch (error) {
			this.logger.error(
				{
					event: "outpatient.payment.records.failed",
					traceId: context.traceId,
					provider: "zhongyang",
					status,
					errorType: error instanceof Error ? error.name : "UnknownError",
				},
				"Outpatient payment records failed",
			);
			throw error;
		}
	}
}

const AuthorizationHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.Optional(t.String({ maxLength: 128 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const OutpatientPaymentQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
	status: OutpatientPaymentStatusSchema,
});

/** 门诊费用列表只接受内部 patientId 和状态，不接受 provider patId 或金额。 */
export function outpatientPaymentsModule(
	service: OutpatientPaymentService,
	sessions: SessionTokenService,
) {
	return new Elysia({ name: "outpatient-payments-module" }).get(
		"/payments/outpatient/records",
		async ({ headers, query }) => {
			const principal = await requirePrincipal(headers.authorization, sessions);
			return success(
				await service.list(
					principal.userId,
					query.patientId,
					query.status,
					adapterContextFromHeaders(headers),
				),
			);
		},
		{
			headers: AuthorizationHeaders,
			query: OutpatientPaymentQuery,
			response: { 200: OutpatientPaymentListResponse },
			tags: ["payments"],
		},
	);
}
