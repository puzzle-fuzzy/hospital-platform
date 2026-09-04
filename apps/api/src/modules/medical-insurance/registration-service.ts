import type {
	MedicalInsuranceAuthorizePayload,
	MedicalInsuranceOrderPayload,
} from "@hospital/contracts";
import {
	type AppointmentMedicalInsuranceContext,
	type AppointmentPatientProfileGateway,
	type AppointmentRegistration,
	type AppointmentWriteRepository,
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	medicalInsuranceOrderTypeForBusiness,
	type MedicalInsuranceGateway,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceQueryTaskRepository,
	normalizeAdapterCallContext,
	type UserIdentityRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationInputError,
} from "./errors";
import { MedicalInsurancePaymentCore } from "./payment-core";

export {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationInputError,
} from "./errors";

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
	/** 可注入统一核心；省略时为兼容旧组合根自动创建同一核心实现。 */
	core?: MedicalInsurancePaymentCore;
	/** 兼容旧组合根，实际由统一核心持有。 */
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

const REGISTRATION_ORDER_TYPE =
	medicalInsuranceOrderTypeForBusiness("registration");

export class MedicalInsuranceRegistrationService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;
	private readonly createId: () => string;
	private readonly core: MedicalInsurancePaymentCore;

	constructor(
		private readonly dependencies: MedicalInsuranceRegistrationServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
		this.core =
			dependencies.core ??
			new MedicalInsurancePaymentCore({
				orders: dependencies.orders,
				medicalInsurance: dependencies.medicalInsurance,
				...(dependencies.queryTasks
					? { queryTasks: dependencies.queryTasks }
					: {}),
				...(dependencies.logger ? { logger: dependencies.logger } : {}),
				...(dependencies.now ? { now: dependencies.now } : {}),
			});
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
		// 统一订单的业务键比单次请求幂等键更重要：同一预约已经创建过
		// 医保订单时，换一个幂等键重试也不能再造一笔订单。新 MySQL 仓储
		// 提供业务键查询；旧仓储没有该方法时仍回退到原有行为。
		if (!order && this.dependencies.orders.findByOwnerAndBusinessKey) {
			order = await this.dependencies.orders.findByOwnerAndBusinessKey(
				ownerUserId,
				"registration",
				appointmentId,
			);
		}
		if (
			order &&
			((order.appointmentId !== undefined &&
				order.appointmentId !== appointmentId) ||
				(order.businessId !== undefined &&
					order.businessId !== appointmentId) ||
				(order.businessType !== undefined &&
					order.businessType !== "registration"))
		)
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
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
				businessId: appointmentId,
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
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
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
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
				businessId: appointmentId,
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
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
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
		if (
			(order.businessType && order.businessType !== "registration") ||
			(order.orderType && order.orderType !== "RegPay")
		)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance order business type is not registration",
			);
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
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
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
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
				businessId: appointment.appointmentId,
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
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
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
		return this.core.settle(input);
	}

	async query(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
		cashPaymentConfirmed?: boolean;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		return this.core.query(input);
	}

	async confirmWechatCashPayment(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		return this.core.confirmWechatCashPayment(input);
	}
}
