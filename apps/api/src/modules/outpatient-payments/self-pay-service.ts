import { createHash } from "node:crypto";
import type {
	OutpatientSelfPayCancelPayload,
	OutpatientSelfPayPayload,
} from "@hospital/contracts";
import {
	type AdapterCallContext,
	type AppointmentPatientProfileGateway,
	DependencyNotConfiguredError,
	type HospitalSettlementGateway,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	normalizeExternalTrace,
	normalizeOutpatientPaymentRecords,
	type OutpatientPaymentGateway,
	type OutpatientSelfPayCancellationGateway,
	type PatientRepository,
	type PaymentOrder,
	PaymentOrderInputError,
	type PaymentOrderService,
	type RegistrationSelfPayPreparationGateway,
	type RegistrationSelfPaySettlementContext,
	type UserIdentityRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

type OutpatientSelfPayServiceDependencies = {
	paymentOrders: PaymentOrderService;
	patients: PatientRepository;
	identityUsers: UserIdentityRepository;
	patientProfile: AppointmentPatientProfileGateway;
	outpatientPayments: OutpatientPaymentGateway;
	preparation: RegistrationSelfPayPreparationGateway;
	hospitalSettlement: HospitalSettlementGateway;
	cancellation?: OutpatientSelfPayCancellationGateway;
	saveContext: (
		ownerUserId: string,
		orderId: string,
		context: RegistrationSelfPaySettlementContext,
	) => Promise<void>;
	getContext: (
		ownerUserId: string,
		orderId: string,
	) => Promise<RegistrationSelfPaySettlementContext | undefined>;
	now?: () => Date;
	logger?: AppLogger;
};

function contextOf(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context)
		throw new PaymentOrderInputError("Outpatient payment context is invalid");
	return context;
}

function opaque(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value))
		throw new PaymentOrderInputError(`${label} is invalid`);
	return value;
}

/** retry: 是内部尝试键空间，不能作为外部费用记录的别名取得另一把锁。 */
function outpatientRecordId(value: unknown): string {
	const recordId = opaque(value, "recordId");
	if (recordId.startsWith("retry:"))
		throw new PaymentOrderInputError(
			"Outpatient payment record is unavailable",
		);
	return recordId;
}

function orderKey(recordId: string): string {
	return `outpatient-self-pay:${recordId}`;
}

export function outpatientSelfPayNextAttemptKey(
	recordId: string,
	previousOrderId: string,
): string {
	return `outpatient-self-pay:retry:${createHash("sha256")
		.update(orderKey(recordId))
		.update("\0")
		.update(previousOrderId)
		.digest("hex")}`;
}

function cancellationOutput(
	recordId: string,
	order: PaymentOrder,
	status: OutpatientSelfPayCancelPayload["data"]["status"],
): OutpatientSelfPayCancelPayload["data"] {
	return {
		recordId,
		orderId: order.orderId,
		status,
		paymentState: order.state,
	};
}

function isPaidOrder(order: PaymentOrder): boolean {
	return (
		order.state === "cash_paid" ||
		order.state === "his_written_back" ||
		order.state === "completed"
	);
}

function providerDateTime(value: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		calendar: "gregory",
		numberingSystem: "latn",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(value);
	const values = Object.fromEntries(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value]),
	);
	return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function startDateTime(now: Date): string {
	return providerDateTime(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
}

function output(
	recordId: string,
	order: PaymentOrder,
	status: OutpatientSelfPayPayload["data"]["status"],
	paymentParams?: OutpatientSelfPayPayload["data"]["payParams"],
): OutpatientSelfPayPayload["data"] {
	return {
		recordId,
		orderId: order.orderId,
		status,
		paymentState: order.state,
		totalFen: order.amounts.cashFen,
		...(paymentParams ? { payParams: paymentParams } : {}),
	};
}

/** 门诊纯微信支付：.1 -> .27 -> .2 -> 微信 -> .5，不进入医保回写链。 */
export class OutpatientSelfPayService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: OutpatientSelfPayServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	/** 同一费用的全部历史尝试共用锁；旧取消请求不能误伤新的尝试。 */
	private async attempt(
		ownerUserId: string,
		recordId: string,
		patientId: string,
		expectedOrderId?: string,
	): Promise<{
		key: string;
		order?: PaymentOrder;
		last: PaymentOrder | undefined;
	}> {
		let key = orderKey(recordId);
		let last: PaymentOrder | undefined;
		const seen = new Set<string>();
		for (let index = 0; index < 64; index += 1) {
			const order =
				await this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
					ownerUserId,
					key,
				);
			if (!order) {
				if (expectedOrderId)
					throw new PaymentOrderInputError(
						"Outpatient self-pay order is unavailable",
					);
				return { key, last };
			}
			if (order.patientId !== patientId || seen.has(order.orderId))
				throw new PaymentOrderInputError(
					"Outpatient self-pay order is unavailable",
				);
			seen.add(order.orderId);
			if (expectedOrderId === order.orderId) return { key, order, last };
			if (order.state !== "cancelled") {
				if (expectedOrderId)
					throw new PaymentOrderInputError(
						"Outpatient self-pay order is unavailable",
					);
				return { key, order, last };
			}
			const saved = await this.dependencies.getContext(
				ownerUserId,
				order.orderId,
			);
			if (saved?.outpatientCancellation?.state !== "cancelled")
				throw new PaymentOrderInputError("原门诊支付撤销尚未确认，请稍后核对");
			last = order;
			key = outpatientSelfPayNextAttemptKey(recordId, order.orderId);
		}
		throw new PaymentOrderInputError("门诊支付历史需要人工核对，请联系医院");
	}

	/** 只有 HIS .5 返回成功后，才把现金订单推进为 completed。 */
	private async completeProviderSettlement(
		ownerUserId: string,
		recordId: string,
		order: PaymentOrder,
		context: AdapterCallContext,
	): Promise<PaymentOrder> {
		if (order.state === "completed") return order;
		if (order.state === "his_written_back") {
			return this.dependencies.paymentOrders.transition(
				ownerUserId,
				order.orderId,
				"completed",
			);
		}
		if (order.state !== "cash_pending" && order.state !== "cash_paid")
			return order;

		try {
			const registrationContext = await this.dependencies.getContext(
				ownerUserId,
				order.orderId,
			);
			if (!registrationContext) {
				this.logger.warn(
					{
						event: "outpatient.self-payment.his-context-pending",
						ownerUserId,
						recordId,
						orderId: order.orderId,
					},
					"Outpatient self-pay HIS context is pending",
				);
				return order;
			}
			if (registrationContext.outpatientCancellation) return order;
			const trace = await this.dependencies.hospitalSettlement.writeBack(
				{
					orderId: order.orderId,
					settlementFlow: "ordinary-self-pay",
					settlement: {
						orderId: order.orderId,
						state: "cash_paid",
						totalFen: order.amounts.totalFen,
						insuranceFen: order.amounts.insuranceFen,
						cashFen: order.amounts.cashFen,
						trace: [],
					},
					registrationContext,
				},
				{
					...context,
					idempotencyKey: `outpatient-self-pay-settlement:${order.orderId}`,
				},
			);
			this.logger.info(
				{
					event: "outpatient.self-payment.provider-settlement-succeeded",
					ownerUserId,
					recordId,
					orderId: order.orderId,
					provider: trace.provider,
					providerRequestId: trace.requestId,
				},
				"Outpatient self-pay Provider settlement succeeded",
			);
		} catch (error) {
			this.logger.warn(
				{
					event: "outpatient.self-payment.provider-settlement-pending",
					ownerUserId,
					recordId,
					orderId: order.orderId,
					errorName: error instanceof Error ? error.name : "UnknownError",
				},
				"Outpatient self-pay Provider settlement is pending",
			);
			return order;
		}

		const paid =
			order.state === "cash_pending"
				? await this.dependencies.paymentOrders.transition(
						ownerUserId,
						order.orderId,
						"cash_paid",
					)
				: order;
		const writtenBack = await this.dependencies.paymentOrders.transition(
			ownerUserId,
			paid.orderId,
			"his_written_back",
		);
		return this.dependencies.paymentOrders.transition(
			ownerUserId,
			writtenBack.orderId,
			"completed",
		);
	}

	private async providerContext(
		ownerUserId: string,
		patientId: string,
		recordId: string,
		context: AdapterCallContext,
	) {
		const outpatientPayments = this.dependencies.outpatientPayments;
		if (!outpatientPayments.resolvePaymentContext)
			throw new DependencyNotConfiguredError("outpatient-payment-context");
		// 门诊费用/结算使用 HIS patId；微信身份绑定接口使用患者目录中的
		// thirdPatientId。两者在众阳侧是不同的引用，不能复用同一个映射。
		const reference = await this.dependencies.patients.resolveProviderReference(
			{
				ownerUserId,
				patientId,
				provider: "zhongyang",
				referenceKind: "his-patient",
			},
		);
		if (!reference)
			throw new PaymentOrderInputError(
				"Outpatient patient mapping is unavailable",
			);
		const directoryReference =
			await this.dependencies.patients.resolveProviderReference({
				ownerUserId,
				patientId,
				provider: "zhongyang",
				referenceKind: "directory",
			});
		if (!directoryReference)
			throw new PaymentOrderInputError(
				"Outpatient patient directory mapping is unavailable",
			);
		const now = this.dependencies.now?.() ?? new Date();
		const resolvedContext = await outpatientPayments.resolvePaymentContext(
			{
				providerPatientId: reference.providerPatientId,
				recordId,
				startTime: startDateTime(now),
				endTime: providerDateTime(now),
			},
			context,
		);
		if (resolvedContext.record !== undefined) {
			const snapshot = normalizeOutpatientPaymentRecords(
				[resolvedContext.record],
				"unpaid",
			)[0];
			if (
				!snapshot ||
				snapshot.recordId !== recordId ||
				snapshot.amountFen !== resolvedContext.totalFen
			) {
				throw new PaymentOrderInputError(
					"Outpatient payment snapshot does not match provider context",
				);
			}
			resolvedContext.record = snapshot;
		}
		return { reference, directoryReference, providerContext: resolvedContext };
	}

	private async prepare(
		ownerUserId: string,
		order: PaymentOrder,
		context: AdapterCallContext,
		provider: Awaited<ReturnType<OutpatientSelfPayService["providerContext"]>>,
	): Promise<RegistrationSelfPaySettlementContext> {
		const identity =
			await this.dependencies.identityUsers.findByUserId(ownerUserId);
		if (!identity?.unionId)
			throw new PaymentOrderInputError("微信身份未完成绑定");
		const profile = await this.dependencies.patientProfile.resolve(
			{
				unionId: identity.unionId,
				providerPatientId: provider.directoryReference.providerPatientId,
			},
			context,
		);
		const prepared = await this.dependencies.preparation.prepare(
			{
				orderId: order.orderId,
				totalFen: order.amounts.totalFen,
				providerPatientId: provider.reference.providerPatientId,
				outTradeOrderIds: provider.providerContext.outTradeOrderIds,
				businessType: "outpatient",
				...(identity.providerSubject
					? { paymentSystemUserId: identity.providerSubject }
					: {}),
				patient: {
					name: profile.patient.name,
					cardNo: profile.patient.cardNo,
					idNo: profile.patient.idNo,
				},
			},
			{
				...context,
				idempotencyKey: `outpatient-self-pay-provider-prepare:${order.orderId}`,
			},
		);
		const registrationContext = {
			...prepared.registrationContext,
			...(provider.providerContext.record
				? { outpatientPaymentRecord: provider.providerContext.record }
				: {}),
		};
		await this.dependencies.saveContext(
			ownerUserId,
			order.orderId,
			registrationContext,
		);
		return registrationContext;
	}

	async create(input: {
		ownerUserId: string;
		recordId: string;
		patientId: string;
		context: unknown;
	}): Promise<OutpatientSelfPayPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const recordId = outpatientRecordId(input.recordId);
		const patientId = opaque(input.patientId, "patientId");
		return this.dependencies.paymentOrders.withBusinessOperationLock(
			ownerUserId,
			orderKey(recordId),
			async () => {
				const attempt = await this.attempt(ownerUserId, recordId, patientId);
				const key = attempt.key;
				let order = attempt.order;
				let registrationContext = order
					? await this.dependencies.getContext(ownerUserId, order.orderId)
					: undefined;
				if (order && registrationContext?.outpatientCancellation)
					return output(
						recordId,
						order,
						order.state === "completed" ? "cash_paid" : "awaiting_confirmation",
					);
				if (order?.state === "awaiting_confirmation")
					return output(recordId, order, "awaiting_confirmation");
				if (order?.state === "failed") return output(recordId, order, "failed");
				if (
					order &&
					(order.state === "cash_paid" ||
						order.state === "his_written_back" ||
						order.state === "completed")
				) {
					const finalized = await this.completeProviderSettlement(
						ownerUserId,
						recordId,
						order,
						context,
					);
					return output(
						recordId,
						finalized,
						finalized.state === "completed"
							? "cash_paid"
							: "awaiting_confirmation",
					);
				}

				if (registrationContext?.payParams && order) {
					const finalized = await this.completeProviderSettlement(
						ownerUserId,
						recordId,
						order,
						context,
					);
					if (finalized.state === "completed")
						return output(recordId, finalized, "cash_paid");
					return output(
						recordId,
						finalized,
						"prepay_ready",
						registrationContext.payParams,
					);
				}

				const provider = await this.providerContext(
					ownerUserId,
					patientId,
					recordId,
					context,
				);
				if (!order) {
					order = await this.dependencies.paymentOrders.createCashPending({
						ownerUserId,
						patientId,
						idempotencyKey: key,
						amounts: {
							totalFen: provider.providerContext.totalFen,
							insuranceFen: 0,
							cashFen: provider.providerContext.totalFen,
						},
					});
					if (order.state === "failed")
						return output(recordId, order, "failed");
				} else if (
					order.amounts.totalFen !== provider.providerContext.totalFen
				) {
					throw new PaymentOrderInputError(
						"Outpatient self-pay amount changed; refresh and retry",
					);
				}
				if (!registrationContext)
					registrationContext = await this.prepare(
						ownerUserId,
						order,
						context,
						provider,
					);
				if (!registrationContext.payParams)
					throw new DependencyNotConfiguredError("outpatient-payment-prepay");
				return output(
					recordId,
					order,
					"prepay_ready",
					registrationContext.payParams,
				);
			},
		);
	}

	async query(input: {
		ownerUserId: string;
		recordId: string;
		patientId: string;
		orderId?: string;
		context: unknown;
	}): Promise<OutpatientSelfPayPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const recordId = outpatientRecordId(input.recordId);
		const patientId = opaque(input.patientId, "patientId");
		const expectedOrderId =
			input.orderId === undefined
				? undefined
				: opaque(input.orderId, "orderId");
		return this.dependencies.paymentOrders.withBusinessOperationLock(
			ownerUserId,
			orderKey(recordId),
			async () => {
				const attempt = await this.attempt(
					ownerUserId,
					recordId,
					patientId,
					expectedOrderId,
				);
				const order = attempt.order ?? attempt.last;
				if (!order)
					throw new PaymentOrderInputError(
						"Outpatient self-pay order is unavailable",
					);
				const finalized = await this.completeProviderSettlement(
					ownerUserId,
					recordId,
					order,
					context,
				);
				return output(
					recordId,
					finalized,
					finalized.state === "completed"
						? "cash_paid"
						: finalized.state === "failed" || finalized.state === "cancelled"
							? "failed"
							: "awaiting_confirmation",
				);
			},
		);
	}

	async cancel(input: {
		ownerUserId: string;
		recordId: string;
		patientId: string;
		orderId: string;
		context: unknown;
	}): Promise<OutpatientSelfPayCancelPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const recordId = outpatientRecordId(input.recordId);
		const patientId = opaque(input.patientId, "patientId");
		const orderId = opaque(input.orderId, "orderId");
		return this.dependencies.paymentOrders.withBusinessOperationLock(
			ownerUserId,
			orderKey(recordId),
			async () => {
				const { order } = await this.attempt(
					ownerUserId,
					recordId,
					patientId,
					orderId,
				);
				if (!order)
					throw new PaymentOrderInputError(
						"Outpatient self-pay order is unavailable",
					);
				if (isPaidOrder(order))
					return cancellationOutput(recordId, order, "already_paid");
				const saved = await this.dependencies.getContext(ownerUserId, orderId);
				if (
					order.state === "cancelled" &&
					saved?.outpatientCancellation?.state === "cancelled"
				)
					return cancellationOutput(recordId, order, "cancelled");
				if (
					saved?.outpatientCancellation?.state === "cancelled" &&
					["cash_pending", "awaiting_confirmation"].includes(order.state)
				) {
					const cancelled = await this.dependencies.paymentOrders.cancel(
						ownerUserId,
						orderId,
					);
					return cancellationOutput(recordId, cancelled, "cancelled");
				}
				if (saved?.outpatientCancellation?.state === "paid")
					return cancellationOutput(recordId, order, "already_paid");
				if (!saved) {
					const pending =
						order.state === "cash_pending"
							? await this.dependencies.paymentOrders.transition(
									ownerUserId,
									orderId,
									"awaiting_confirmation",
								)
							: order;
					return cancellationOutput(recordId, pending, "awaiting_confirmation");
				}
				if (!["cash_pending", "awaiting_confirmation"].includes(order.state))
					return cancellationOutput(recordId, order, "awaiting_confirmation");
				const requestedAt =
					saved.outpatientCancellation?.requestedAt ??
					(this.dependencies.now?.() ?? new Date()).toISOString();
				// 在触网前持久化退出意图；进程退出、Provider 超时也不能继续使用原预单。
				const requested = {
					...saved,
					outpatientCancellation: { state: "requested" as const, requestedAt },
				};
				await this.dependencies.saveContext(ownerUserId, orderId, requested);
				if (!this.dependencies.cancellation)
					throw new DependencyNotConfiguredError(
						"outpatient-self-pay-cancellation",
					);
				let state: "cancelled" | "awaiting_confirmation" | "paid" =
					"awaiting_confirmation";
				try {
					const result = await this.dependencies.cancellation.cancel(
						{
							orderId,
							totalFen: order.amounts.totalFen,
							registrationContext: requested,
						},
						context,
					);
					const trace = normalizeExternalTrace(result.trace, {
						expectedProvider: "yunhealth",
					});
					if (
						trace.operation !== "outpatient-self-pay.cancellation" ||
						!isBoundedOpaqueIdentifier(result.providerStatus)
					)
						throw new PaymentOrderInputError(
							"Outpatient cancellation evidence is unavailable",
						);
					if (
						trace.providerOrderId !== undefined &&
						trace.providerOrderId !== saved.businessId
					)
						throw new PaymentOrderInputError(
							"Outpatient cancellation context is unavailable",
						);
					if (
						["cancelled", "awaiting_confirmation", "paid"].includes(
							result.state,
						)
					)
						state = result.state;
				} catch (error) {
					this.logger.warn(
						{
							event: "outpatient.self-payment.cancellation-pending",
							orderId,
							traceId: context.traceId,
							errorName: error instanceof Error ? error.name : "UnknownError",
						},
						"Outpatient cancellation result is pending",
					);
				}
				await this.dependencies.saveContext(ownerUserId, orderId, {
					...requested,
					outpatientCancellation: { state, requestedAt },
				});
				if (state === "cancelled") {
					const cancelled = await this.dependencies.paymentOrders.cancel(
						ownerUserId,
						orderId,
					);
					return cancellationOutput(recordId, cancelled, "cancelled");
				}
				return cancellationOutput(
					recordId,
					order,
					state === "paid" ? "already_paid" : "awaiting_confirmation",
				);
			},
		);
	}
}
