import type {
	AppointmentRecord,
	AppointmentRecordProviderReference,
	AppointmentRegistration,
	AppointmentWriteRepository,
	MedicalInsuranceOrderRepository,
	PaymentOrderRepository,
} from "@hospital/domain";

export type AppointmentPaymentProjection = {
	status: AppointmentRecord["status"];
	paymentStatus:
		| "pending"
		| "confirming"
		| "paid"
		| "expired"
		| "cancelled"
		| "unavailable";
	canPay: boolean;
	payExpiresAt?: string;
};

/** HIS 状态、截止和资金事实在列表、详情与支付门禁共用同一解释。 */
export function projectAppointmentPayment(input: {
	record?: AppointmentRecord;
	reference?: AppointmentRecordProviderReference;
	registration?: AppointmentRegistration;
	paid?: boolean;
	confirming?: boolean;
	now: Date;
}): AppointmentPaymentProjection {
	const { record, reference, registration } = input;
	const status = record?.status ?? "unknown";
	const payExpiresAt = reference?.payExpiresAt;
	const deadline = payExpiresAt ? Date.parse(payExpiresAt) : Number.NaN;
	const expired = Number.isFinite(deadline) && deadline <= input.now.getTime();
	const base = {
		status,
		...(payExpiresAt ? { payExpiresAt } : {}),
		canPay: false,
	};
	// 已经由医院取消命令或明确医院记录确认的本地取消事实不可被旧列表复活。
	if (registration?.status === "cancelled")
		return { ...base, status: "cancelled", paymentStatus: "cancelled" };
	// 预约终态与资金账分开：医院取消仍同步，但不迁移资金状态。
	if (status === "cancelled" || status === "expired") {
		const automaticallyExpired =
			status === "expired" ||
			(reference?.cancelledBySystem === true && expired);
		return {
			...base,
			status: automaticallyExpired ? "expired" : "cancelled",
			paymentStatus: automaticallyExpired ? "expired" : "cancelled",
		};
	}
	if (input.paid || status === "completed")
		return { ...base, paymentStatus: "paid" };
	if (input.confirming) return { ...base, paymentStatus: "confirming" };
	if (
		!record ||
		!reference ||
		reference.needPay !== true ||
		status !== "scheduled" ||
		!Number.isFinite(deadline)
	) {
		return { ...base, paymentStatus: "unavailable" };
	}
	if (expired) return { ...base, paymentStatus: "expired" };
	return {
		...base,
		paymentStatus: "pending",
		canPay: registration?.status === "booked",
	};
}

/** 已支付/待确认只从服务端资金账读取，不能从预约 booked 推断。 */
export async function appointmentPaymentFacts(
	registration: AppointmentRegistration | undefined,
	dependencies: {
		paymentOrders?: Pick<
			PaymentOrderRepository,
			"findByOwnerAndIdempotencyKey"
		>;
		medicalInsuranceOrders?: Pick<
			MedicalInsuranceOrderRepository,
			"listByOwnerAndBusinessKey"
		>;
	},
): Promise<{ paid: boolean; confirming: boolean }> {
	if (!registration) return { paid: false, confirming: false };
	const [cash, medical] = await Promise.all([
		dependencies.paymentOrders?.findByOwnerAndIdempotencyKey(
			registration.ownerUserId,
			`registration-self-pay:${registration.appointmentId}`,
		),
		dependencies.medicalInsuranceOrders?.listByOwnerAndBusinessKey?.(
			registration.ownerUserId,
			"registration",
			registration.appointmentId,
		),
	]);
	return {
		paid: Boolean(
			(cash &&
				["cash_paid", "his_written_back", "completed"].includes(cash.state)) ||
				medical?.some(
					(order) =>
						order.status === "insurance_settled" &&
						(order.amounts?.cashFen === 0 ||
							order.wechatPaymentState === "cash_paid"),
				),
		),
		confirming:
			cash?.state === "awaiting_confirmation" ||
			Boolean(
				medical?.some(
					(order) =>
						order.status === "awaiting_confirmation" ||
						order.status === "manual_review",
				),
			),
	};
}

/** 只同步明确的医院取消，不关闭或迁移任何资金订单。 */
export async function synchronizeAppointmentCancellation(
	registration: AppointmentRegistration | undefined,
	projection: AppointmentPaymentProjection,
	repository: Partial<Pick<AppointmentWriteRepository, "updateRegistration">>,
	now: Date,
): Promise<void> {
	if (
		registration?.status !== "booked" ||
		(projection.status !== "cancelled" && projection.status !== "expired")
	)
		return;
	await repository.updateRegistration?.(
		{
			...registration,
			status: projection.status,
			updatedAt: now.toISOString(),
		},
		registration.status,
	);
}
