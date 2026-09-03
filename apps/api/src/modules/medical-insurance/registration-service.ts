import type {
	MedicalInsuranceAuthorizePayload,
	MedicalInsuranceOrderPayload,
} from "@hospital/contracts";
import {
	type AppointmentMedicalInsuranceContext,
	type AppointmentPatientProfileGateway,
	type AppointmentRegistration,
	type AppointmentWriteRepository,
	assertValidMedicalInsuranceAmounts,
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
	type MedicalInsuranceGateway,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceQueryTaskRepository,
	type MedicalInsuranceSettlementEvidenceFinality,
	normalizeAdapterCallContext,
	type UserIdentityRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

export class MedicalInsuranceRegistrationInputError extends Error {
	constructor(message = "Medical insurance registration input is invalid") {
		super(message);
		this.name = "MedicalInsuranceRegistrationInputError";
	}
}

export class MedicalInsuranceOrderNotFoundError extends Error {
	constructor() {
		super("Medical insurance order was not found");
		this.name = "MedicalInsuranceOrderNotFoundError";
	}
}

export class MedicalInsuranceAppointmentNotFoundError extends Error {
	constructor() {
		super("Appointment for medical insurance was not found");
		this.name = "MedicalInsuranceAppointmentNotFoundError";
	}
}

export type MedicalInsuranceRegistrationServiceDependencies = {
	orders: MedicalInsuranceOrderRepository;
	appointments: AppointmentWriteRepository;
	identityUsers: UserIdentityRepository;
	patientProfile: AppointmentPatientProfileGateway;
	medicalInsurance: MedicalInsuranceGateway;
	/** 6202 非终态结果必须进入持久化查单队列；测试组合根可省略。 */
	queryTasks?: MedicalInsuranceQueryTaskRepository;
	logger?: AppLogger;
	now?: () => Date;
	createId?: () => string;
};

function contextOf(value: unknown) {
	const context = normalizeAdapterCallContext(value);
	if (!context)
		throw new MedicalInsuranceRegistrationInputError(
			"Medical insurance context is invalid",
		);
	return context;
}

function opaque(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value))
		throw new MedicalInsuranceRegistrationInputError(`${label} is invalid`);
	return value;
}

function output(
	order: MedicalInsuranceOrder,
): MedicalInsuranceOrderPayload["data"] {
	return {
		orderId: order.medicalOrderId,
		status: order.status,
		...(order.amounts
			? {
					amounts: {
						totalFen: order.amounts.totalFen,
						insuranceFen:
							order.amounts.personalAccountFen + order.amounts.fundFen,
						cashFen: order.amounts.cashFen,
					},
				}
			: {}),
	};
}

function emptySettlementPatch(order: MedicalInsuranceOrder) {
	return {
		status: order.status,
		ordStas: order.ordStas,
		amounts: order.amounts,
		setlType: order.setlType,
		revsTokenHash: order.revsTokenHash,
		revsTokenExpiresAt: order.revsTokenExpiresAt,
	};
}

function needsMedicalInsuranceQuery(
	finality: MedicalInsuranceSettlementEvidenceFinality,
): boolean {
	return (
		finality === "processing" ||
		finality === "settlement_candidate" ||
		finality === "unknown"
	);
}

export class MedicalInsuranceRegistrationService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;
	private readonly createId: () => string;

	constructor(
		private readonly dependencies: MedicalInsuranceRegistrationServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
	}

	private async appointment(
		ownerUserId: string,
		appointmentId: string,
	): Promise<AppointmentRegistration> {
		const appointment = await this.dependencies.appointments.findRegistration(
			ownerUserId,
			appointmentId,
		);
		if (appointment?.status !== "booked")
			throw new MedicalInsuranceAppointmentNotFoundError();
		return appointment;
	}

	private async patient(
		ownerUserId: string,
		appointment: AppointmentRegistration,
		context: ReturnType<typeof contextOf>,
	) {
		const identity =
			await this.dependencies.identityUsers.findByUserId(ownerUserId);
		if (!identity?.unionId || !identity.providerSubject)
			throw new MedicalInsuranceRegistrationInputError(
				"微信身份未完成 unionId/openid 绑定，无法解析医保授权",
			);
		const result = await this.dependencies.patientProfile.resolve(
			{
				unionId: identity.unionId,
				providerPatientId: appointment.providerPatientId,
			},
			context,
		);
		return { identity, patient: result.patient };
	}

	private async enqueueQueryTask(orderId: string): Promise<void> {
		if (!this.dependencies.queryTasks) return;
		const timestamp = this.now().toISOString();
		await this.dependencies.queryTasks.insert({
			// 订单 ID 本身已经是有界 opaque 标识；复用它可保持 taskId 稳定，
			// 同一订单不会因重试生成多个查单任务。
			taskId: orderId,
			medicalOrderId: orderId,
			status: "pending",
			version: 1,
			attempts: 0,
			maxAttempts: MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
			nextAttemptAt: timestamp,
			claimedUntil: null,
			terminalOrdStas: null,
			lastErrorCode: null,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
	}

	async authorize(input: {
		ownerUserId: string;
		appointmentId: string;
		authCode: string;
		context: unknown;
	}): Promise<MedicalInsuranceAuthorizePayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const appointmentId = opaque(input.appointmentId, "appointmentId");
		if (
			typeof input.authCode !== "string" ||
			!input.authCode.trim() ||
			input.authCode.length > 512
		)
			throw new MedicalInsuranceRegistrationInputError("authCode is invalid");
		const appointment = await this.appointment(ownerUserId, appointmentId);
		let order = await this.dependencies.orders.findByOwnerAndIdempotencyKey(
			ownerUserId,
			context.idempotencyKey,
		);
		if (order && order.appointmentId !== appointmentId)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance idempotency key conflicts with appointment",
			);
		if (!order) {
			const now = this.now().toISOString();
			const medicalOrderId = this.createId();
			order = await this.dependencies.orders.insert({
				medicalOrderId,
				ownerUserId,
				patientId: appointment.patientId,
				appointmentId,
				authorizationId: null,
				feeUploadId: null,
				idempotencyKey: context.idempotencyKey,
				medOrgOrd: medicalOrderId,
				chrgBchno: this.createId().replaceAll("-", ""),
				payOrdId: null,
				payTokenHash: null,
				mdtrtId: null,
				acctUsedFlag: null,
				status: "created",
				ordStas: null,
				amounts: null,
				setlType: null,
				revsTokenHash: null,
				revsTokenExpiresAt: null,
				lastError: null,
				version: 1,
				createdAt: now,
				updatedAt: now,
			});
		}
		if (order.authorizationId)
			return { orderId: order.medicalOrderId, status: "authorized" };
		const { identity, patient } = await this.patient(
			ownerUserId,
			appointment,
			context,
		);
		this.logger.info(
			{
				event: "medical-insurance.authorization.requested",
				traceId: context.traceId,
				ownerUserId,
				orderId: order.medicalOrderId,
				appointmentId,
			},
			"Medical insurance authorization requested",
		);
		const result = await this.dependencies.medicalInsurance.authorize(
			{
				authCode: input.authCode,
				patientId: appointment.providerPatientId,
				ownerUserId,
				orderId: order.medicalOrderId,
				providerSubject: identity.providerSubject,
				patient,
			},
			context,
		);
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
				authorizationId: result.authorizationId,
				appointmentId,
			},
		);
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		this.logger.info(
			{
				event: "medical-insurance.authorization.completed",
				traceId: context.traceId,
				ownerUserId,
				orderId: order.medicalOrderId,
				appointmentId,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance authorization completed",
		);
		return { orderId: updated.medicalOrderId, status: "authorized" };
	}

	async uploadFees(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId)
			throw new MedicalInsuranceOrderNotFoundError();
		if (!order.authorizationId || !order.appointmentId)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance authorization is required",
			);
		if (order.status !== "created") return output(order);
		const appointment = await this.appointment(
			ownerUserId,
			order.appointmentId,
		);
		this.logger.info(
			{
				event: "medical-insurance.fees.requested",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				appointmentId: appointment.appointmentId,
			},
			"Medical insurance fee upload requested",
		);
		const result = await this.dependencies.medicalInsurance.uploadFees(
			{
				orderId,
				ownerUserId,
				patientId: appointment.providerPatientId,
				authorizationId: order.authorizationId,
				appointment: {
					appointmentId: appointment.appointmentId,
					providerAppointmentId: appointment.providerAppointmentId,
					providerPatientId: appointment.providerPatientId,
					...(appointment.providerRegisterId
						? { providerRegisterId: appointment.providerRegisterId }
						: {}),
					...(appointment.providerHisRegisterId
						? { providerHisRegisterId: appointment.providerHisRegisterId }
						: {}),
					...(appointment.departmentId
						? { departmentId: appointment.departmentId }
						: {}),
					departmentName: appointment.departmentName,
					...(appointment.doctorId ? { doctorId: appointment.doctorId } : {}),
					doctorName: appointment.doctorName,
					workDate: appointment.workDate,
					shiftName: appointment.shiftName,
					sourceSerialNumber: appointment.sourceSerialNumber,
					totalFen: appointment.totalFen,
				} satisfies AppointmentMedicalInsuranceContext,
			},
			context,
		);
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
				status: "fee_uploaded",
				feeUploadId: result.feeUploadId,
				payOrdId: result.payOrdId,
				payTokenHash: result.payTokenHash,
				mdtrtId: result.mdtrtId,
				acctUsedFlag: result.acctUsedFlag,
			},
		);
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		this.logger.info(
			{
				event: "medical-insurance.fees.completed",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				appointmentId: appointment.appointmentId,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance fee upload completed",
		);
		return output(updated);
	}

	async settle(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId)
			throw new MedicalInsuranceOrderNotFoundError();
		if (!order.authorizationId || !order.feeUploadId)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance fee upload is required",
			);
		if (order.status === "awaiting_confirmation") {
			// 结算事实可能已经提交而任务写入在网络故障中丢失；重试命令
			// 必须能够补回同一 taskId，不能再次调用 6202。
			await this.enqueueQueryTask(order.medicalOrderId);
			return output(order);
		}
		if (
			order.status === "insurance_settled" ||
			order.status === "cash_pending" ||
			order.status === "failed"
		)
			return output(order);
		this.logger.info(
			{
				event: "medical-insurance.settlement.requested",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				appointmentId: order.appointmentId,
			},
			"Medical insurance settlement requested",
		);
		const result = await this.dependencies.medicalInsurance.settle(
			{
				orderId,
				ownerUserId,
				authorizationId: order.authorizationId,
				feeUploadId: order.feeUploadId,
				mdtrtId: order.mdtrtId ?? "",
				acctUsedFlag: order.acctUsedFlag ?? "",
			},
			context,
		);
		const amounts = assertValidMedicalInsuranceAmounts(result.amounts);
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: result.state,
				ordStas: result.providerStatus,
				amounts,
				setlType: amounts.cashFen > 0 ? "CASH" : "ALL",
				revsTokenHash: null,
				revsTokenExpiresAt: null,
			},
		);
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		if (needsMedicalInsuranceQuery(result.finality))
			await this.enqueueQueryTask(order.medicalOrderId);
		this.logger.info(
			{
				event: "medical-insurance.settlement.completed",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				appointmentId: order.appointmentId,
				state: result.state,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance settlement completed",
		);
		return output(updated);
	}

	async query(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
		cashPaymentConfirmed?: boolean;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId)
			throw new MedicalInsuranceOrderNotFoundError();
		const result = await this.dependencies.medicalInsurance.query(
			{
				orderId,
				ownerUserId,
				...(input.cashPaymentConfirmed ? { cashPaymentConfirmed: true } : {}),
			},
			context,
		);
		const amounts = assertValidMedicalInsuranceAmounts({
			totalFen: result.amounts.totalFen,
			cashFen: result.amounts.cashFen,
			personalAccountFen:
				order.amounts?.personalAccountFen ?? result.amounts.insuranceFen,
			fundFen: order.amounts?.fundFen ?? 0,
		});
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: result.state,
				ordStas: result.providerStatus,
				amounts,
				setlType: amounts.cashFen > 0 ? "CASH" : "ALL",
				revsTokenHash: null,
				revsTokenExpiresAt: null,
			},
		);
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		if (needsMedicalInsuranceQuery(result.finality))
			await this.enqueueQueryTask(order.medicalOrderId);
		this.logger.info(
			{
				event: "medical-insurance.settlement.queried",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				state: result.state,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance settlement queried",
		);
		return output(updated);
	}

	/**
	 * 微信混合订单确认现金支付后，重新进入医保 6301/后置完成链路。
	 * 微信客户端回调不是业务终态，只有这里的 provider 证据可以推进医保订单。
	 */
	async confirmWechatCashPayment(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId)
			throw new MedicalInsuranceOrderNotFoundError();
		if (order.wechatPaymentState !== "cash_paid") return output(order);
		return this.query({
			ownerUserId,
			orderId,
			context: input.context,
			cashPaymentConfirmed: true,
		});
	}
}
