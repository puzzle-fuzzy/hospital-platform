import { createHash } from "node:crypto";
import { ProviderRequestError } from "@hospital/adapters";
import {
	type AdapterCallContext,
	AppointmentCancellationBusyError,
	type AppointmentRecord,
	type AppointmentRecordDirectoryGateway,
	type AppointmentRegistration,
	type AppointmentWriteRepository,
	buildMedicalInsuranceOrderOperationsProjection,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceRefund,
	type MedicalInsuranceRefundRepository,
	medicalInsuranceOperationsAmounts,
	normalizeAdapterCallContext,
	normalizeAppointmentRecordProviderReferences,
	normalizeAppointmentRecordResults,
	type PaymentOperationsRepository,
	type PaymentOperatorAuditRepository,
	type PaymentOrder,
	type PaymentOrderRepository,
	type PaymentSyncRepository,
	type WechatRefund,
	type WechatRefundRepository,
	type WechatRefundSource,
} from "@hospital/domain";
import { RegistrationPaymentExitInputError } from "../payments/registration-payment-exit-service";

export type AdminRegistrationStatus = {
	appointmentId: string | null;
	localStatus: AppointmentRegistration["status"] | "not_found";
	hospitalStatus: AppointmentRecord["status"] | "not_checked" | "unavailable";
	hospitalPaymentStatus: "pending" | "paid" | "unavailable";
	checkedAt: string | null;
	departmentName?: string;
	doctorName?: string;
	workDate?: string;
	shiftName?: string;
	sourceSerialNumber?: string;
	cancellation: {
		allowed: boolean;
		mode: "cancel_only" | "unavailable";
		reason: string;
	};
};

export type AdminRegistrationResult = {
	source: WechatRefundSource;
	orderId: string;
	registration: AdminRegistrationStatus;
};

export type AdminRegistrationCancelInput = {
	source: WechatRefundSource;
	orderId: string;
	reason: string;
	context: unknown;
	operatorRef: string;
};

type CancellationCallback = (input: {
	ownerUserId: string;
	appointmentId: string;
	context: AdapterCallContext;
}) => Promise<{ appointmentId: string; status: "cancelled" }>;

export type AdminRegistrationServiceDependencies = {
	appointments: Pick<AppointmentWriteRepository, "findRegistration">;
	paymentOrders: Pick<
		PaymentOrderRepository,
		| "findById"
		| "findByOwnerAndIdempotencyKey"
		| "getRegistrationSelfPayContext"
	>;
	medicalOrders: Pick<
		MedicalInsuranceOrderRepository,
		| "findByMedicalOrderId"
		| "listByOwnerAndBusinessKey"
		| "getSettlementContext"
	>;
	wechatRefunds: Pick<WechatRefundRepository, "findBySourceAndSourceOrder">;
	medicalRefunds: Pick<
		MedicalInsuranceRefundRepository,
		"listByMedicalOrderId"
	>;
	paymentSync: Pick<PaymentSyncRepository, "findTaskById">;
	operations?: Pick<PaymentOperationsRepository, "findAggregateByBusinessKey">;
	audits?: Pick<PaymentOperatorAuditRepository, "append">;
	records?: AppointmentRecordDirectoryGateway;
	withCancellationLock?: <T>(
		ownerUserId: string,
		appointmentId: string,
		operation: () => Promise<T>,
	) => Promise<T>;
	directCancel?: CancellationCallback;
	cancelAfterRefund?: CancellationCallback;
	/** Must disable automatic refunds and fail closed if a payment is found. */
	cancelUnpaid?: CancellationCallback;
	now?: () => Date;
	createId?: () => string;
};

export class AdminRegistrationInputError extends Error {
	constructor(message = "挂号操作参数不合法") {
		super(message);
		this.name = "AdminRegistrationInputError";
	}
}

export class AdminRegistrationNotFoundError extends Error {
	constructor() {
		super("挂号订单不存在或与预约不一致");
		this.name = "AdminRegistrationNotFoundError";
	}
}

export class AdminRegistrationUnavailableError extends Error {
	constructor(message = "当前挂号不能安全取消，请先核对医院和支付状态") {
		super(message);
		this.name = "AdminRegistrationUnavailableError";
	}
}

type OrderInput = { source: WechatRefundSource; orderId: string };
type Binding = OrderInput & {
	ownerUserId: string;
	patientId: string;
	appointmentId: string;
	registration?: AppointmentRegistration;
};
type Route = "direct" | "unpaid" | "refunded";
type Policy = { route?: Route; reason: string };
const selfPayPrefix = "registration-self-pay:";
const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const validFen = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validOutTradeNo = (value: unknown): value is string =>
	typeof value === "string" && /^[A-Za-z0-9_*-]{1,32}$/u.test(value);
const blocked = (reason: string): Policy => ({ reason });

function normalize(input: OrderInput): OrderInput {
	if (
		!["payment_order", "medical_insurance"].includes(input.source) ||
		!isBoundedOpaqueIdentifier(input.orderId)
	)
		throw new AdminRegistrationInputError();
	return { source: input.source, orderId: input.orderId };
}

function medicalAppointment(order: MedicalInsuranceOrder): string | undefined {
	const appointmentId = order.appointmentId ?? order.businessId;
	if (
		!isBoundedOpaqueIdentifier(appointmentId) ||
		order.businessType === "outpatient" ||
		order.orderType === "DiagPay" ||
		(order.businessType !== "registration" && !order.appointmentId) ||
		(order.businessId && order.businessId !== appointmentId) ||
		(order.appointmentId && order.appointmentId !== appointmentId)
	)
		return undefined;
	return appointmentId;
}

/** Pure reads classify money; only explicit cancellation callbacks can write. */
export class AdminRegistrationService {
	private readonly now: () => Date;
	private readonly createId: () => string;
	constructor(
		private readonly dependencies: AdminRegistrationServiceDependencies,
	) {
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
	}

	private async binding(value: OrderInput): Promise<Binding> {
		const input = normalize(value);
		let ownerUserId: string;
		let patientId: string;
		let appointmentId: string | undefined;
		if (input.source === "payment_order") {
			const order = await this.dependencies.paymentOrders.findById(
				input.orderId,
			);
			if (!order?.idempotencyKey.startsWith(selfPayPrefix))
				throw new AdminRegistrationNotFoundError();
			ownerUserId = order.ownerUserId;
			patientId = order.patientId;
			appointmentId = order.idempotencyKey.slice(selfPayPrefix.length);
		} else {
			const order = await this.dependencies.medicalOrders.findByMedicalOrderId(
				input.orderId,
			);
			if (!order) throw new AdminRegistrationNotFoundError();
			ownerUserId = order.ownerUserId;
			patientId = order.patientId;
			appointmentId = medicalAppointment(order);
		}
		if (
			!isBoundedOpaqueIdentifier(ownerUserId) ||
			!isBoundedOpaqueIdentifier(patientId) ||
			!isBoundedOpaqueIdentifier(appointmentId)
		)
			throw new AdminRegistrationNotFoundError();
		const registration = await this.dependencies.appointments.findRegistration(
			ownerUserId,
			appointmentId,
		);
		if (
			registration &&
			(registration.ownerUserId !== ownerUserId ||
				registration.patientId !== patientId ||
				registration.appointmentId !== appointmentId)
		)
			throw new AdminRegistrationNotFoundError();
		return {
			...input,
			ownerUserId,
			patientId,
			appointmentId,
			...(registration ? { registration } : {}),
		};
	}

	private local(binding: Binding): AdminRegistrationStatus {
		const item = binding.registration;
		return {
			appointmentId: item?.appointmentId ?? null,
			localStatus: item?.status ?? "not_found",
			hospitalStatus: "not_checked",
			hospitalPaymentStatus: "unavailable",
			checkedAt: null,
			...(item
				? {
						departmentName: item.departmentName,
						doctorName: item.doctorName,
						workDate: item.workDate,
						shiftName: item.shiftName,
						sourceSerialNumber: item.sourceSerialNumber,
					}
				: {}),
			cancellation: {
				allowed: false,
				mode: "unavailable",
				reason: item ? "请先刷新医院挂号状态" : "未找到可操作的本地挂号记录",
			},
		};
	}

	async localForOrder(input: OrderInput): Promise<AdminRegistrationResult> {
		const binding = await this.binding(input);
		return { ...normalize(input), registration: this.local(binding) };
	}

	private async cashRefunds(
		source: WechatRefundSource,
		orderId: string,
	): Promise<readonly WechatRefund[]> {
		const list = this.dependencies.wechatRefunds.findBySourceAndSourceOrder;
		if (!list)
			throw new AdminRegistrationUnavailableError("退款台账查询未配置");
		const records = await list(source, orderId);
		if (
			new Set(records.map((item) => item.merchantRefundNo)).size !==
				records.length ||
			records.some(
				(item) =>
					item.source !== source ||
					item.sourceOrderId !== orderId ||
					!validFen(item.refundFen) ||
					item.refundFen <= 0 ||
					!validFen(item.totalFen) ||
					item.refundFen > item.totalFen,
			)
		)
			throw new AdminRegistrationUnavailableError("退款台账与原订单不一致");
		return records;
	}

	private successfulCash(
		records: readonly WechatRefund[],
		expectedFen: number,
	): boolean {
		return (
			records.every(
				(item) =>
					item.totalFen === expectedFen &&
					item.status === "success" &&
					item.providerStatus === "SUCCESS" &&
					!!item.providerRefundId &&
					!!item.successTime &&
					Number.isFinite(Date.parse(item.successTime)),
			) &&
			records.reduce((sum, item) => sum + item.refundFen, 0) === expectedFen
		);
	}

	private async selfPayPolicy(
		order: PaymentOrder,
		binding: Binding,
	): Promise<Policy> {
		const records = await this.cashRefunds("payment_order", order.orderId);
		if (
			!validFen(order.amounts.totalFen) ||
			order.amounts.totalFen <= 0 ||
			order.amounts.insuranceFen !== 0 ||
			order.amounts.cashFen !== order.amounts.totalFen ||
			order.amounts.totalFen !== binding.registration?.totalFen
		)
			return blocked("挂号支付金额与预约不一致，请先核对");
		if (["cash_paid", "his_written_back", "completed"].includes(order.state)) {
			if (order.state !== "completed")
				return blocked("医院结算尚未确认完成，请先核对");
			if (!this.successfulCash(records, order.amounts.cashFen))
				return blocked("已支付挂号请先完成全额退款和医院回写，再取消挂号");
			const context =
				await this.dependencies.paymentOrders.getRegistrationSelfPayContext?.(
					order.ownerUserId,
					order.orderId,
				);
			const marker = context?.refundWriteBack;
			if (
				!context ||
				!validOutTradeNo(context.outTradeNo) ||
				context.outTradeNoSource !== "yunhealth_2_6_65_2" ||
				(context.payTypeId === "5032" &&
					context.outTradeNo === context.businessCode) ||
				records.some((item) => item.outTradeNo !== context.outTradeNo) ||
				!marker ||
				marker.validationVersion !== 1 ||
				records.length !== 1 ||
				marker.merchantRefundNo !== records[0]?.merchantRefundNo ||
				marker.refundFen !== order.amounts.cashFen ||
				!Number.isFinite(Date.parse(marker.syncedAt))
			)
				return blocked("微信已退款，医院退款回写尚未严格确认，暂不能取消挂号");
			return {
				route: "refunded",
				reason: "退款和医院回写已完成，可取消挂号；不会再次退款",
			};
		}
		if (records.length) return blocked("存在未核清的退款记录，请先核对");
		if (order.state === "cancelled")
			return { route: "direct", reason: "支付已安全关闭，可取消挂号" };
		if (
			["created", "authorized", "pre_settled", "cash_pending"].includes(
				order.state,
			)
		)
			return {
				route: "unpaid",
				reason: "取消前将安全关闭原支付订单，不发起退款",
			};
		return blocked("支付状态尚未核清，请先核对原支付订单");
	}

	private async notificationConfirmed(
		refund: MedicalInsuranceRefund,
		aggregateId: string,
	): Promise<boolean> {
		const id = `medrefundnotify-${digest(refund.refundNo).slice(0, 40)}`;
		const task = await this.dependencies.paymentSync.findTaskById(id);
		if (!task) return false;
		const prefix = `medical_refund_notify:${refund.refundNo}:`;
		const suffix = task.businessKey.slice(prefix.length);
		const [encodedTime, fingerprint, extra] = suffix.split(":");
		const time = Number.parseInt(encodedTime ?? "", 36);
		return (
			task.taskId === id &&
			task.aggregateId === aggregateId &&
			task.businessKey.startsWith(prefix) &&
			task.businessKey.length <= 128 &&
			extra === undefined &&
			/^[0-9a-z]+$/.test(encodedTime ?? "") &&
			Number.isSafeInteger(time) &&
			time > 0 &&
			time <= Date.parse(task.createdAt) &&
			/^[A-Za-z0-9_-]{43}$/.test(fingerprint ?? "") &&
			task.source === "wechat_pay" &&
			task.kind === "writeback" &&
			task.status === "succeeded" &&
			task.claimedUntil === null &&
			task.lastErrorCode === null &&
			/^[a-f0-9]{64}$/.test(task.resultDigest ?? "")
		);
	}

	private async medicalPolicy(
		order: MedicalInsuranceOrder,
		binding: Binding,
	): Promise<Policy> {
		const [cash, medical, settlement] = await Promise.all([
			this.cashRefunds("medical_insurance", order.medicalOrderId),
			this.dependencies.medicalRefunds.listByMedicalOrderId(
				order.medicalOrderId,
			),
			this.dependencies.medicalOrders.getSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
			),
		]);
		if (
			medical.some(
				(item) =>
					item.medicalOrderId !== order.medicalOrderId ||
					item.ownerUserId !== order.ownerUserId ||
					item.payOrdId !== order.payOrdId,
			) ||
			new Set(medical.map((item) => item.refundNo)).size !== medical.length
		)
			return blocked("医保退款记录与原订单不一致，请先核对");
		if (order.status === "insurance_settled") {
			let amounts: ReturnType<typeof medicalInsuranceOperationsAmounts>;
			try {
				amounts = medicalInsuranceOperationsAmounts(order, settlement);
			} catch {
				return blocked("医保支付金额分项尚未核清，请先核对");
			}
			if (
				!order.amounts ||
				!amounts?.proven ||
				amounts.unallocatedFen !== 0 ||
				order.amounts?.totalFen !== binding.registration?.totalFen ||
				(amounts.wechatCashFen > 0 && order.wechatPaymentState !== "cash_paid")
			)
				return blocked("医保及微信实际支付分项尚未核清，请先核对");
			if (
				!this.successfulCash(cash, amounts.wechatCashFen) ||
				(amounts.wechatCashFen > 0 &&
					(!validOutTradeNo(order.wechatOutTradeNo) ||
						cash.some((item) => item.outTradeNo !== order.wechatOutTradeNo)))
			)
				return blocked("已支付挂号请先完成实际微信付款的全额退款");
			if (
				medical.some(
					(item) =>
						!validFen(item.fundFen) ||
						!validFen(item.personalAccountFen) ||
						!validFen(item.cashFen) ||
						item.medicalStatus !== "success" ||
						item.medicalRefStatus !== "SUCC" ||
						item.lastErrorCode !== null ||
						item.totalFen !==
							item.cashFen + item.personalAccountFen + item.fundFen ||
						(item.cashFen > 0 &&
							(item.wechatStatus !== "success" ||
								!cash.some(
									(row) =>
										row.merchantRefundNo === item.wechatMerchantRefundNo &&
										row.refundFen === item.cashFen,
								))),
				) ||
				medical.reduce((sum, item) => sum + item.fundFen, 0) !==
					order.amounts.fundFen ||
				medical.reduce((sum, item) => sum + item.personalAccountFen, 0) !==
					order.amounts.personalAccountFen
			)
				return blocked("已支付挂号请先完成医保全额退款和医院回写");
			const aggregateId = buildMedicalInsuranceOrderOperationsProjection(
				order,
				undefined,
				settlement,
			)?.aggregate.aggregateId;
			if (!aggregateId) return blocked("医保原支付关联尚未核清");
			for (const refund of medical) {
				if (
					refund.fundFen + refund.personalAccountFen > 0 &&
					!(await this.notificationConfirmed(refund, aggregateId))
				)
					return blocked("医保已退款，医院退款通知尚未确认完成");
			}
			return {
				route: "refunded",
				reason: "原医保和微信实付款已全额退回、医院回写已确认，可仅取消挂号",
			};
		}
		if (
			cash.length ||
			medical.length ||
			order.wechatPaymentState === "cash_paid"
		)
			return blocked("存在支付或退款资金记录，请先核对后操作");
		if (order.status === "cancelled")
			return { route: "direct", reason: "原医保支付已安全关闭，可取消挂号" };
		if (
			order.status === "failed" &&
			!order.payOrdId &&
			!order.feeUploadId &&
			!settlement &&
			!order.wechatMixTradeNo &&
			!order.wechatOutTradeNo &&
			!order.amounts
		)
			return { route: "direct", reason: "医保支付未形成资金订单，可取消挂号" };
		if (
			[
				"created",
				"fee_upload_pending",
				"fee_uploaded",
				"order_placed",
				"cash_pending",
			].includes(order.status) &&
			order.wechatPaymentState !== "unknown"
		)
			return {
				route: "unpaid",
				reason: "取消前将安全关闭原医保支付订单，不发起退款",
			};
		return blocked("医保支付状态尚未核清，请先核对原订单");
	}

	private async finance(binding: Binding): Promise<Policy> {
		const list = this.dependencies.medicalOrders.listByOwnerAndBusinessKey;
		if (!list) return blocked("完整医保订单查询未配置，暂不能安全取消挂号");
		const [cash, medical] = await Promise.all([
			this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
				binding.ownerUserId,
				`${selfPayPrefix}${binding.appointmentId}`,
			),
			list(binding.ownerUserId, "registration", binding.appointmentId),
		]);
		if (
			(cash &&
				(cash.ownerUserId !== binding.ownerUserId ||
					cash.patientId !== binding.patientId ||
					cash.idempotencyKey !==
						`${selfPayPrefix}${binding.appointmentId}`)) ||
			medical.some(
				(item) =>
					item.ownerUserId !== binding.ownerUserId ||
					item.patientId !== binding.patientId ||
					medicalAppointment(item) !== binding.appointmentId,
			) ||
			new Set(medical.map((item) => item.medicalOrderId)).size !==
				medical.length ||
			(binding.source === "payment_order" &&
				cash?.orderId !== binding.orderId) ||
			(binding.source === "medical_insurance" &&
				!medical.some((item) => item.medicalOrderId === binding.orderId))
		)
			return blocked("挂号关联了不一致的支付记录，请先人工核对");
		const policies: Policy[] = [];
		if (cash) policies.push(await this.selfPayPolicy(cash, binding));
		for (const order of medical)
			policies.push(await this.medicalPolicy(order, binding));
		const rejected = policies.find((item) => !item.route);
		if (rejected) return rejected;
		const active = policies.filter((item) => item.route !== "direct");
		if (active.length > 1)
			return blocked("同一挂号存在多笔未收束的支付订单，请先人工核对");
		return (
			active[0] ?? { route: "direct", reason: "无未完成资金订单，可取消挂号" }
		);
	}

	private async inspect(
		binding: Binding,
		context: AdapterCallContext,
	): Promise<{ registration: AdminRegistrationStatus; policy: Policy }> {
		const registration = this.local(binding);
		registration.checkedAt = this.now().toISOString();
		if (!binding.registration)
			return {
				registration,
				policy: blocked(registration.cancellation.reason),
			};
		if (!this.dependencies.records) {
			registration.hospitalStatus = "unavailable";
			registration.cancellation.reason = "医院挂号查询未配置，暂不能取消";
			return {
				registration,
				policy: blocked(registration.cancellation.reason),
			};
		}
		try {
			const result = await this.dependencies.records.listRecords(
				{
					providerPatientId: binding.registration.providerPatientId,
					query: { scope: "all" },
				},
				context,
			);
			const records = normalizeAppointmentRecordResults(result.records);
			const references = normalizeAppointmentRecordProviderReferences(
				result.providerRecordReferences,
				records.length,
			);
			const matches = references.filter(
				(item) =>
					item.providerAppointmentId ===
					binding.registration?.providerAppointmentId,
			);
			const reference = matches.length === 1 ? matches[0] : undefined;
			const record = reference ? records[reference.recordIndex] : undefined;
			registration.hospitalStatus = record?.status ?? "unknown";
			registration.hospitalPaymentStatus =
				record?.status === "completed" || reference?.needPay === false
					? "paid"
					: reference?.needPay === true
						? "pending"
						: "unavailable";
		} catch {
			registration.hospitalStatus = "unavailable";
		}
		let policy: Policy;
		if (registration.hospitalStatus === "cancelled")
			policy = blocked("医院已取消挂号，无需重复操作");
		else if (registration.hospitalStatus !== "scheduled")
			policy = blocked(
				registration.hospitalStatus === "unavailable"
					? "医院状态暂时无法获取，请稍后刷新"
					: "医院当前挂号状态不支持取消，请联系医院核对",
			);
		else if (registration.localStatus !== "booked")
			policy = blocked("本地与医院挂号状态不一致，请先核对");
		else {
			try {
				policy = await this.finance(binding);
			} catch {
				policy = blocked("支付或退款证据暂时无法核实，请稍后刷新");
			}
			if (
				policy.route === "unpaid" &&
				registration.hospitalPaymentStatus !== "pending"
			)
				policy = blocked("医院未确认当前挂号待支付，暂不能安全取消");
			if (
				policy.route === "direct" &&
				registration.hospitalPaymentStatus !== "pending"
			)
				policy = blocked("医院收款状态尚未核清，请先核对");
		}
		const configured =
			!!this.dependencies.withCancellationLock &&
			!!this.dependencies.audits &&
			!!(policy.route === "direct"
				? this.dependencies.directCancel
				: policy.route === "unpaid"
					? this.dependencies.cancelUnpaid
					: policy.route === "refunded"
						? this.dependencies.cancelAfterRefund
						: false);
		if (policy.route && !configured)
			policy = blocked("管理端安全取消流程尚未配置");
		registration.cancellation = {
			allowed: !!policy.route,
			mode: policy.route ? "cancel_only" : "unavailable",
			reason: policy.reason,
		};
		return { registration, policy };
	}

	private context(value: unknown): AdapterCallContext {
		const context = normalizeAdapterCallContext(value);
		if (!context) throw new AdminRegistrationInputError("操作请求上下文不合法");
		return context;
	}

	private async audit(
		binding: Binding,
		context: AdapterCallContext,
		operatorRef: string | undefined,
		action: "registration_status_read" | "registration_cancel",
		outcome: "succeeded" | "failed" | "rejected",
		reason: string,
	): Promise<void> {
		const audits = this.dependencies.audits;
		if (!audits)
			throw new AdminRegistrationUnavailableError("管理员操作审计未配置");
		const aggregate =
			await this.dependencies.operations?.findAggregateByBusinessKey(
				`${binding.source}:${binding.orderId}`,
			);
		await audits.append({
			auditId: `audit-${this.createId()}`,
			operatorRef: operatorRef ?? null,
			action,
			...(aggregate ? { aggregateId: aggregate.aggregateId } : {}),
			requestId: context.traceId,
			outcome,
			reasonCode:
				action === "registration_cancel"
					? "admin-registration-cancel"
					: "admin-registration-status",
			resultDigest: digest(
				JSON.stringify({
					source: binding.source,
					orderId: binding.orderId,
					appointmentId: binding.appointmentId,
					reason,
				}),
			),
			occurredAt: this.now().toISOString(),
		});
	}

	async query(
		input: OrderInput & { context: unknown; operatorRef?: string },
	): Promise<AdminRegistrationResult> {
		const context = this.context(input.context);
		const binding = await this.binding(input);
		const { registration } = await this.inspect(binding, context);
		await this.audit(
			binding,
			context,
			input.operatorRef,
			"registration_status_read",
			"succeeded",
			registration.hospitalStatus,
		);
		return { ...normalize(input), registration };
	}

	async cancel(
		input: AdminRegistrationCancelInput,
	): Promise<
		AdminRegistrationResult & { outcome: "cancelled" | "already_cancelled" }
	> {
		const context = this.context(input.context);
		if (
			!/^admin-session:[a-f0-9]{40}$/.test(input.operatorRef) ||
			typeof input.reason !== "string" ||
			input.reason.trim().length < 2 ||
			input.reason.trim().length > 80 ||
			Array.from(input.reason).some(
				(character) =>
					character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
			)
		)
			throw new AdminRegistrationInputError(
				"取消挂号必须填写有效原因并确认管理员身份",
			);
		const withLock = this.dependencies.withCancellationLock;
		if (!withLock || !this.dependencies.audits)
			throw new AdminRegistrationUnavailableError(
				"管理员审计或持久化取消锁未配置",
			);
		const initial = await this.binding(input);
		try {
			return await withLock(
				initial.ownerUserId,
				initial.appointmentId,
				async () => {
					const binding = await this.binding(input);
					if (
						binding.ownerUserId !== initial.ownerUserId ||
						binding.appointmentId !== initial.appointmentId ||
						binding.patientId !== initial.patientId
					)
						throw new AdminRegistrationUnavailableError(
							"挂号关联已变化，请刷新后重新操作",
						);
					const { registration, policy } = await this.inspect(binding, context);
					if (registration.hospitalStatus === "cancelled") {
						await this.audit(
							binding,
							context,
							input.operatorRef,
							"registration_cancel",
							"succeeded",
							input.reason.trim(),
						);
						return {
							...normalize(input),
							registration,
							outcome: "already_cancelled" as const,
						};
					}
					if (!policy.route) {
						await this.audit(
							binding,
							context,
							input.operatorRef,
							"registration_cancel",
							"rejected",
							input.reason.trim(),
						);
						throw new AdminRegistrationUnavailableError(policy.reason);
					}
					// Audit storage must work before any Provider or payment-state write.
					await this.audit(
						binding,
						context,
						input.operatorRef,
						"registration_status_read",
						"succeeded",
						input.reason.trim(),
					);
					const callback =
						policy.route === "direct"
							? this.dependencies.directCancel
							: policy.route === "unpaid"
								? this.dependencies.cancelUnpaid
								: this.dependencies.cancelAfterRefund;
					if (!callback) throw new AdminRegistrationUnavailableError();
					try {
						const result = await callback({
							ownerUserId: binding.ownerUserId,
							appointmentId: binding.appointmentId,
							context,
						});
						if (
							result.appointmentId !== binding.appointmentId ||
							result.status !== "cancelled"
						)
							throw new AdminRegistrationUnavailableError(
								"医院取消结果尚未确认，请刷新核对",
							);
					} catch (error) {
						await this.audit(
							binding,
							context,
							input.operatorRef,
							"registration_cancel",
							"failed",
							input.reason.trim(),
						);
						if (error instanceof AdminRegistrationUnavailableError) throw error;
						if (error instanceof ProviderRequestError) throw error;
						if (error instanceof RegistrationPaymentExitInputError)
							throw new AdminRegistrationUnavailableError(
								"支付状态已变化，请先核对原订单；已付款的请先退费，再取消挂号",
							);
						throw new AdminRegistrationUnavailableError(
							"取消结果尚未确认，请刷新医院挂号状态后再操作",
						);
					}
					await this.audit(
						binding,
						context,
						input.operatorRef,
						"registration_cancel",
						"succeeded",
						input.reason.trim(),
					);
					return {
						...normalize(input),
						registration: {
							...registration,
							localStatus: "cancelled",
							hospitalStatus: "cancelled",
							hospitalPaymentStatus: "unavailable",
							checkedAt: this.now().toISOString(),
							cancellation: {
								allowed: false,
								mode: "unavailable",
								reason: "挂号已取消",
							},
						},
						outcome: "cancelled",
					};
				},
			);
		} catch (error) {
			if (error instanceof AppointmentCancellationBusyError)
				throw new AdminRegistrationUnavailableError(
					"该挂号正在处理中，请稍后核对",
				);
			throw error;
		}
	}
}
