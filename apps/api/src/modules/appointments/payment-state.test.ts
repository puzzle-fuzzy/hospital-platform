import { expect, test } from "bun:test";
import {
	type AppointmentRecord,
	type AppointmentRecordProviderReference,
	type AppointmentRegistration,
	DependencyNotConfiguredError,
	type PaymentOrder,
} from "@hospital/domain";
import {
	createInMemoryAppointmentWriteRepository,
	createInMemoryPaymentOrderRepository,
} from "@hospital/persistence";
import { AppointmentService } from "./service";
import {
	AppointmentPaymentUnavailableError,
	AppointmentRegistrationNotFoundError,
	AppointmentWriteService,
} from "./write-service";

const now = new Date("2026-10-13T02:00:00.000Z");
const context = {
	traceId: "trace-expiry-001",
	idempotencyKey: "expiry-request-001",
};
const registration: AppointmentRegistration = {
	appointmentId: "appointment-expiry-001",
	ownerUserId: "user-expiry-001",
	patientId: "patient-expiry-001",
	holdId: "hold-expiry-001",
	idempotencyKey: "register-expiry-001",
	providerAppointmentId: "provider-appointment-001",
	providerPatientId: "provider-patient-001",
	departmentName: "测试科室",
	doctorName: "测试医生",
	workDate: "2026-10-14",
	shiftName: "上午",
	sourceSerialNumber: "1",
	totalFen: 1000,
	status: "booked",
	createdAt: "2026-10-13T01:00:00.000Z",
	updatedAt: "2026-10-13T01:00:00.000Z",
};
const future = "2026-10-13T03:00:00.000Z";
const past = "2026-10-13T01:30:00.000Z";

test("已过期预约重复取消保持幂等且不再请求 HIS 或修改资金", async () => {
	const expired = { ...registration, status: "expired" as const };
	const repository = createInMemoryAppointmentWriteRepository([], [expired]);
	let cancellations = 0;
	const writes = new AppointmentWriteService({
		repository,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		gateway: {
			cancel: async () => {
				cancellations += 1;
				throw new Error("must not cancel again");
			},
		} as never,
		snapshots: {} as never,
	});
	await expect(
		writes.cancel({
			ownerUserId: expired.ownerUserId,
			appointmentId: expired.appointmentId,
			context,
		}),
	).resolves.toMatchObject({ status: "cancelled" });
	expect(cancellations).toBe(0);
	expect(
		(
			await repository.findRegistration(
				expired.ownerUserId,
				expired.appointmentId,
			)
		)?.status,
	).toBe("expired");
});

function setup(
	input: {
		status?: AppointmentRecord["status"];
		needPay?: boolean;
		payExpiresAt?: string;
		cancelledBySystem?: boolean;
		missing?: boolean;
		paymentState?: PaymentOrder["state"];
		noRecords?: boolean;
		providerError?: Error;
	} = {},
) {
	const repository = createInMemoryAppointmentWriteRepository(
		[],
		[registration],
	);
	const paymentOrders = createInMemoryPaymentOrderRepository(
		input.paymentState
			? [
					{
						orderId: "cash-expiry-001",
						ownerUserId: registration.ownerUserId,
						patientId: registration.patientId,
						idempotencyKey: `registration-self-pay:${registration.appointmentId}`,
						amounts: { totalFen: 1000, insuranceFen: 0, cashFen: 1000 },
						state: input.paymentState,
						version: 1,
						createdAt: now.toISOString(),
						updatedAt: now.toISOString(),
					},
				]
			: [],
	);
	const reference: AppointmentRecordProviderReference = {
		recordIndex: 0,
		providerAppointmentId: registration.providerAppointmentId,
		...(input.needPay === undefined ? {} : { needPay: input.needPay }),
		...(input.payExpiresAt ? { payExpiresAt: input.payExpiresAt } : {}),
		...(input.cancelledBySystem === undefined
			? {}
			: { cancelledBySystem: input.cancelledBySystem }),
	};
	const records = {
		listRecords: async (query: {
			providerPatientId: string;
			query: { scope?: string };
		}) => {
			if (input.providerError) throw input.providerError;
			expect(query).toEqual({
				providerPatientId: registration.providerPatientId,
				query: { scope: "all" },
			});
			return {
				records: [
					{
						workDate: registration.workDate,
						status: input.status ?? "scheduled",
					},
				],
				providerRecordReferences: [
					{
						...reference,
						...(input.missing
							? { providerAppointmentId: "another-provider-appointment" }
							: {}),
					},
				],
				trace: {
					provider: "zhongyang" as const,
					operation: "appointment-records",
					requestId: "expiry-provider-001",
				},
			};
		},
	};
	const patients = {
		listByOwner: async () => [
			{
				id: registration.patientId,
				ownerUserId: registration.ownerUserId,
				displayName: "测试患者",
				relationship: "self",
				cardNumberMasked: "****001",
				source: "hospital-his",
				clinicalAccess: "ready",
			},
		],
		resolveProviderReference: async () => ({
			patientId: registration.patientId,
			provider: "zhongyang",
			providerPatientId: registration.providerPatientId,
			referenceKind: "his-patient",
		}),
	} as never;
	const writes = new AppointmentWriteService({
		repository,
		patients,
		...(input.noRecords ? {} : { records }),
		requireHospitalPaymentState: true,
		paymentOrders,
		identityUsers: {} as never,
		patientProfile: {} as never,
		gateway: {} as never,
		snapshots: {} as never,
		now: () => now,
	});
	const lists = new AppointmentService({
		repository: patients,
		records,
		appointmentWrites: repository,
		paymentOrders,
		directory: {} as never,
		now: () => now,
	});
	const detail = () =>
		writes.getDetail({
			ownerUserId: registration.ownerUserId,
			patientId: registration.patientId,
			appointmentId: registration.appointmentId,
			context,
		});
	const assertPay = () =>
		writes.assertPaymentAllowed(
			registration.ownerUserId,
			registration.appointmentId,
			context,
		);
	return { repository, paymentOrders, writes, lists, detail, assertPay };
}

for (const scenario of [
	{
		label: "系统取消且截止已过",
		status: "cancelled",
		needPay: true,
		payExpiresAt: past,
		cancelledBySystem: true,
		expectedStatus: "expired",
		paymentStatus: "expired",
		localStatus: "expired",
		canPay: false,
	},
	{
		label: "人工取消不冒充超时",
		status: "cancelled",
		needPay: true,
		payExpiresAt: past,
		cancelledBySystem: false,
		expectedStatus: "cancelled",
		paymentStatus: "cancelled",
		localStatus: "cancelled",
		canPay: false,
	},
	{
		label: "截止已过但医院未取消",
		status: "scheduled",
		needPay: true,
		payExpiresAt: past,
		expectedStatus: "scheduled",
		paymentStatus: "expired",
		localStatus: "booked",
		canPay: false,
	},
	{
		label: "正常未来截止待缴费",
		status: "scheduled",
		needPay: true,
		payExpiresAt: future,
		expectedStatus: "scheduled",
		paymentStatus: "pending",
		localStatus: "booked",
		canPay: true,
	},
	{
		label: "缺截止不可付款",
		status: "scheduled",
		needPay: true,
		expectedStatus: "scheduled",
		paymentStatus: "unavailable",
		localStatus: "booked",
		canPay: false,
	},
	{
		label: "无需支付不冒充已付款",
		status: "scheduled",
		needPay: false,
		payExpiresAt: future,
		expectedStatus: "scheduled",
		paymentStatus: "unavailable",
		localStatus: "booked",
		canPay: false,
	},
	{
		label: "已登记不重复发起付款",
		status: "registered",
		needPay: true,
		payExpiresAt: future,
		expectedStatus: "registered",
		paymentStatus: "unavailable",
		localStatus: "booked",
		canPay: false,
	},
	{
		label: "HIS 已完成不被截止覆盖",
		status: "completed",
		needPay: true,
		payExpiresAt: past,
		expectedStatus: "completed",
		paymentStatus: "paid",
		localStatus: "booked",
		canPay: false,
	},
	{
		label: "资金已付不被截止覆盖",
		status: "scheduled",
		needPay: true,
		payExpiresAt: past,
		paymentState: "completed",
		expectedStatus: "scheduled",
		paymentStatus: "paid",
		localStatus: "booked",
		canPay: false,
	},
	{
		label: "资金待确认仍同步医院取消",
		status: "cancelled",
		needPay: true,
		payExpiresAt: past,
		cancelledBySystem: true,
		paymentState: "awaiting_confirmation",
		expectedStatus: "expired",
		paymentStatus: "expired",
		localStatus: "expired",
		canPay: false,
	},
	{
		label: "已付仍同步医院取消且保留收款事实",
		status: "cancelled",
		needPay: true,
		payExpiresAt: past,
		cancelledBySystem: true,
		paymentState: "cash_paid",
		expectedStatus: "expired",
		paymentStatus: "expired",
		localStatus: "expired",
		canPay: false,
	},
] as const) {
	test(`挂号列表和详情统一支付状态：${scenario.label}`, async () => {
		const fixture = setup(scenario);
		const detail = await fixture.detail();
		const list = await fixture.lists.listRecords(
			registration.ownerUserId,
			registration.patientId,
			{ scope: "all" },
			context,
		);
		for (const result of [detail, list.items[0]])
			expect(result).toMatchObject({
				status: scenario.expectedStatus,
				paymentStatus: scenario.paymentStatus,
				canPay: scenario.canPay,
			});
		expect(
			(
				await fixture.repository.findRegistration(
					registration.ownerUserId,
					registration.appointmentId,
				)
			)?.status,
		).toBe(scenario.localStatus);
		if (scenario.canPay) await fixture.assertPay();
		else
			await expect(fixture.assertPay()).rejects.toBeInstanceOf(
				AppointmentPaymentUnavailableError,
			);
		if ("paymentState" in scenario)
			expect(
				(
					await fixture.paymentOrders.findByOwnerAndIdempotencyKey(
						registration.ownerUserId,
						`registration-self-pay:${registration.appointmentId}`,
					)
				)?.state,
			).toBe(scenario.paymentState);
		// 即使预约同步为 expired，旧资金查询仍能读取服务端金额上下文。
		expect(
			(
				await fixture.writes.getPaymentContext(
					registration.ownerUserId,
					registration.appointmentId,
				)
			).totalFen,
		).toBe(1000);
	});
}

test("挂号 HIS 缺失引用只标记不可支付，不猜测无单或同步取消", async () => {
	const fixture = setup({ missing: true, needPay: true, payExpiresAt: future });
	expect(await fixture.detail()).toMatchObject({
		status: "unknown",
		paymentStatus: "unavailable",
		canPay: false,
	});
	await expect(fixture.assertPay()).rejects.toBeInstanceOf(
		AppointmentPaymentUnavailableError,
	);
	expect(
		(
			await fixture.repository.findRegistration(
				registration.ownerUserId,
				registration.appointmentId,
			)
		)?.status,
	).toBe("booked");
	await expect(
		fixture.writes.assertPaymentAllowed(
			"another-user",
			registration.appointmentId,
			context,
		),
	).rejects.toBeInstanceOf(AppointmentRegistrationNotFoundError);
});

test("生产组合缺失或故障 HIS gateway 时详情和新付款都明确失败", async () => {
	for (const input of [
		{ noRecords: true },
		{ providerError: new DependencyNotConfiguredError("appointment-records") },
	]) {
		const fixture = setup(input);
		await expect(fixture.detail()).rejects.toBeInstanceOf(
			DependencyNotConfiguredError,
		);
		await expect(fixture.assertPay()).rejects.toBeInstanceOf(
			DependencyNotConfiguredError,
		);
		expect(
			(
				await fixture.repository.findRegistration(
					registration.ownerUserId,
					registration.appointmentId,
				)
			)?.status,
		).toBe("booked");
	}
});
