import {
	type AppointmentWriteRepository,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceOrderRepository,
	type PaymentOrderRepository,
} from "@hospital/domain";
import { guardRegistrationOperations } from "./registration-operation-lock";

type Scope = { ownerUserId: string; appointmentId: string };
type Input = { ownerUserId: string; [key: string]: unknown };
function operationInput(value: unknown): Input | undefined {
	if (!value || typeof value !== "object") return undefined;
	const input = value as Record<string, unknown>;
	return isBoundedOpaqueIdentifier(input.ownerUserId)
		? (input as Input)
		: undefined;
}

/** 只由已验证服务输入和原订单解析锁目标，不接受客户端指定另一个锁或跳锁标志。 */
export function createRegistrationOperationGuard(dependencies: {
	appointments: Pick<AppointmentWriteRepository, "withCancellationLock">;
	paymentOrders: Pick<PaymentOrderRepository, "findByOwnerAndId">;
	medicalOrders: Pick<MedicalInsuranceOrderRepository, "findByMedicalOrderId">;
}) {
	const appointment = async (value: unknown): Promise<Scope | undefined> => {
		const input = operationInput(value);
		return input && isBoundedOpaqueIdentifier(input.appointmentId)
			? { ownerUserId: input.ownerUserId, appointmentId: input.appointmentId }
			: undefined;
	};
	const medical = async (value: unknown): Promise<Scope | undefined> => {
		const input = operationInput(value);
		if (!input) return undefined;
		// 已有 orderId 时必须从原单解析，不能让额外 appointmentId 改变互斥目标。
		if (!isBoundedOpaqueIdentifier(input.orderId)) {
			return appointment(value);
		}
		const order = await dependencies.medicalOrders.findByMedicalOrderId(
			input.orderId,
		);
		if (
			!order ||
			order.ownerUserId !== input.ownerUserId ||
			order.businessType === "outpatient" ||
			order.orderType === "DiagPay"
		)
			return undefined;
		const id = order.appointmentId ?? order.businessId;
		if (!isBoundedOpaqueIdentifier(id)) return undefined;
		return { ownerUserId: order.ownerUserId, appointmentId: id };
	};
	const selfPayOrder = async (value: unknown): Promise<Scope | undefined> => {
		const input = operationInput(value);
		if (!input || !isBoundedOpaqueIdentifier(input.orderId)) return undefined;
		const order = await dependencies.paymentOrders.findByOwnerAndId(
			input.ownerUserId,
			input.orderId,
		);
		if (!order || order.ownerUserId !== input.ownerUserId) return undefined;
		const prefix = "registration-self-pay:";
		if (order.idempotencyKey.startsWith(prefix)) {
			const id = order.idempotencyKey.slice(prefix.length);
			return isBoundedOpaqueIdentifier(id)
				? { ownerUserId: order.ownerUserId, appointmentId: id }
				: undefined;
		}
		const pluginPrefix = "registration-medical-plugin-self-pay:";
		return order.idempotencyKey.startsWith(pluginPrefix)
			? medical({
					ownerUserId: order.ownerUserId,
					orderId: order.idempotencyKey.slice(pluginPrefix.length),
				})
			: undefined;
	};
	const wrap = <T extends object>(
		service: T,
		methods: readonly (keyof T)[],
		resolve: (value: unknown) => Promise<Scope | undefined>,
	): T =>
		guardRegistrationOperations(
			service,
			methods,
			resolve,
			dependencies.appointments.withCancellationLock?.bind(
				dependencies.appointments,
			),
		);
	return {
		appointment: <T extends object>(
			service: T,
			methods: readonly (keyof T)[],
		) => wrap(service, methods, appointment),
		medical: <T extends object>(service: T, methods: readonly (keyof T)[]) =>
			wrap(service, methods, medical),
		selfPayOrder: <T extends object>(
			service: T,
			methods: readonly (keyof T)[],
		) => wrap(service, methods, selfPayOrder),
	};
}
