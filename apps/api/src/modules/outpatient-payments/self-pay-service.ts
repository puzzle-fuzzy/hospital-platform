import type { OutpatientSelfPayPayload } from "@hospital/contracts";
import {
	type AdapterCallContext,
	type AppointmentPatientProfileGateway,
	DependencyNotConfiguredError,
	type HospitalSettlementGateway,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	type OutpatientPaymentGateway,
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

function orderKey(recordId: string): string {
	return `outpatient-self-pay:${recordId}`;
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

/** 门诊纯微信支付：复用挂号的 .1 -> .27 -> .2 -> 微信 -> .5 编排。 */
export class OutpatientSelfPayService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: OutpatientSelfPayServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
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
			const trace = await this.dependencies.hospitalSettlement.writeBack(
				{
					orderId: order.orderId,
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
		const resolved = this.dependencies.outpatientPayments.resolvePaymentContext;
		if (!resolved)
			throw new DependencyNotConfiguredError("outpatient-payment-context");
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
		const now = this.dependencies.now?.() ?? new Date();
		const resolvedContext = await resolved(
			{
				providerPatientId: reference.providerPatientId,
				recordId,
				startTime: startDateTime(now),
				endTime: providerDateTime(now),
			},
			context,
		);
		return { reference, providerContext: resolvedContext };
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
				providerPatientId: provider.reference.providerPatientId,
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
		await this.dependencies.saveContext(
			ownerUserId,
			order.orderId,
			prepared.registrationContext,
		);
		return prepared.registrationContext;
	}

	async create(input: {
		ownerUserId: string;
		recordId: string;
		patientId: string;
		context: unknown;
	}): Promise<OutpatientSelfPayPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const recordId = opaque(input.recordId, "recordId");
		const patientId = opaque(input.patientId, "patientId");
		const key = orderKey(recordId);
		let order =
			await this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
				ownerUserId,
				key,
			);
		if (order && order.patientId !== patientId)
			throw new PaymentOrderInputError(
				"Outpatient self-pay order is unavailable",
			);
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
				finalized.state === "completed" ? "cash_paid" : "awaiting_confirmation",
			);
		}

		let registrationContext = order
			? await this.dependencies.getContext(ownerUserId, order.orderId)
			: undefined;
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
			if (order.state === "failed") return output(recordId, order, "failed");
		} else if (order.amounts.totalFen !== provider.providerContext.totalFen) {
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
	}

	async query(input: {
		ownerUserId: string;
		recordId: string;
		patientId: string;
		context: unknown;
	}): Promise<OutpatientSelfPayPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const recordId = opaque(input.recordId, "recordId");
		const patientId = opaque(input.patientId, "patientId");
		const order =
			await this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
				ownerUserId,
				orderKey(recordId),
			);
		if (!order || order.patientId !== patientId)
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
				: finalized.state === "failed"
					? "failed"
					: "awaiting_confirmation",
		);
	}
}
