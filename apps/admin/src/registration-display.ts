import type {
	AdminRegistrationStatus,
	AdminWechatRefundPaymentRecord,
} from "./types";

export function registrationStatusLabel(
	registration?: AdminRegistrationStatus,
): string {
	if (!registration) return "待核对";
	if (registration.hospitalStatus === "not_checked")
		return {
			booked: "平台已预约 / 医院未核对",
			cancelled: "平台已取消 / 医院未核对",
			expired: "平台已失效 / 医院未核对",
			unknown: "医院未核对",
			not_found: "未找到关联挂号",
		}[registration.localStatus];
	return {
		scheduled: "已预约",
		registered: "已登记",
		cancelled: "已取消",
		expired: "已失效",
		completed: "已完成",
		missed: "已爽约",
		stopped: "已停诊",
		substituted: "替诊",
		unknown: "医院状态待核对",
		unavailable: "医院状态暂不可用",
	}[registration.hospitalStatus];
}

export function canCancelRegistration(
	registration?: AdminRegistrationStatus,
): boolean {
	return Boolean(
		registration?.appointmentId &&
			registration.checkedAt &&
			registration.cancellation.allowed === true &&
			registration.cancellation.mode === "cancel_only" &&
			registration.hospitalStatus === "scheduled" &&
			registration.localStatus === "booked",
	);
}

export function validCancellationReason(reason: string): boolean {
	return (
		reason.trim().length >= 2 &&
		reason.trim().length <= 80 &&
		!Array.from(reason).some(
			(character) =>
				character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f,
		)
	);
}

export function registrationPaymentLabel(
	status: AdminRegistrationStatus["hospitalPaymentStatus"],
): string {
	return { pending: "未支付", paid: "已支付", unavailable: "待核对" }[status];
}

export type RegistrationCancellationAttempt = {
	idempotencyKey: string;
	reason: string;
	needsQuery: boolean;
};

export function cancellationAttemptStorageKey(
	record: Pick<AdminWechatRefundPaymentRecord, "source" | "orderId">,
): string {
	return `admin.registration-cancel:${record.source}:${record.orderId}`;
}

export function readCancellationAttempt(
	storage: Pick<Storage, "getItem">,
	key: string,
): RegistrationCancellationAttempt | undefined {
	try {
		const value: unknown = JSON.parse(storage.getItem(key) || "null");
		if (!value || typeof value !== "object") return undefined;
		const attempt = value as Partial<RegistrationCancellationAttempt>;
		if (
			typeof attempt.idempotencyKey !== "string" ||
			!/^[A-Za-z0-9._:-]{1,128}$/u.test(attempt.idempotencyKey) ||
			typeof attempt.reason !== "string" ||
			!validCancellationReason(attempt.reason) ||
			typeof attempt.needsQuery !== "boolean"
		)
			return undefined;
		return {
			idempotencyKey: attempt.idempotencyKey,
			reason: attempt.reason,
			needsQuery: true,
		};
	} catch {
		return undefined;
	}
}
