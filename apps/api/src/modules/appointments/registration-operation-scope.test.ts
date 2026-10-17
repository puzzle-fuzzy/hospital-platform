import { expect, test } from "bun:test";
import {
	AppointmentCancellationBusyError,
	type AppointmentRegistration,
	DependencyNotConfiguredError,
	type MedicalInsuranceOrder,
	type PaymentOrder,
} from "@hospital/domain";
import {
	createInMemoryAppointmentWriteRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryPaymentOrderRepository,
} from "@hospital/persistence";
import { createRegistrationOperationGuard } from "./registration-operation-scope";

const owner = "fixture-owner";
const appointmentId = "fixture-appointment";
const medicalOrderId = "fixture-medical-order";
const cashOrderId = "fixture-cash-order";
const instant = "2026-10-17T05:00:00.000Z";

function registration(): AppointmentRegistration {
	return {
		ownerUserId: owner,
		appointmentId,
		patientId: "fixture-patient",
		holdId: "fixture-hold",
		idempotencyKey: "fixture-booking-key",
		providerAppointmentId: "fixture-provider-appointment",
		providerPatientId: "fixture-provider-patient",
		departmentName: "测试门诊",
		doctorName: "测试医生",
		workDate: "2026-10-17",
		shiftName: "上午",
		sourceSerialNumber: "8",
		totalFen: 1000,
		status: "booked",
		createdAt: instant,
		updatedAt: instant,
	};
}

function medical(): MedicalInsuranceOrder {
	return {
		medicalOrderId,
		ownerUserId: owner,
		patientId: "fixture-patient",
		businessType: "registration",
		businessId: appointmentId,
		appointmentId,
		orderType: "RegPay",
		idempotencyKey: "fixture-medical-key",
		medOrgOrd: "fixture-org-order",
		chrgBchno: "fixture-charge-batch",
		payOrdId: null,
		payTokenHash: null,
		status: "created",
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: instant,
		updatedAt: instant,
	};
}

function cash(): PaymentOrder {
	return {
		orderId: cashOrderId,
		ownerUserId: owner,
		patientId: "fixture-patient",
		idempotencyKey: `registration-self-pay:${appointmentId}`,
		amounts: { totalFen: 1000, cashFen: 1000, insuranceFen: 0 },
		state: "created",
		version: 1,
		createdAt: instant,
		updatedAt: instant,
	};
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function fixture(
	options: {
		medical?: MedicalInsuranceOrder;
		cash?: PaymentOrder;
		lock?: boolean;
	} = {},
) {
	const appointments = createInMemoryAppointmentWriteRepository(
		[],
		[registration()],
	);
	const paymentOrders = createInMemoryPaymentOrderRepository([
		options.cash ?? cash(),
	]);
	const medicalOrders = createInMemoryMedicalInsuranceOrderRepository();
	await medicalOrders.insert(options.medical ?? medical());
	const targets: { ownerUserId: string; appointmentId: string }[] = [];
	const guard = createRegistrationOperationGuard({
		appointments:
			options.lock === false
				? {}
				: {
						withCancellationLock: async (
							ownerUserId,
							appointmentId,
							operation,
						) => {
							targets.push({ ownerUserId, appointmentId });
							if (!appointments.withCancellationLock)
								throw new Error("Missing fixture lock");
							return appointments.withCancellationLock(
								ownerUserId,
								appointmentId,
								operation,
							);
						},
					},
		paymentOrders,
		medicalOrders,
	});
	return { appointments, paymentOrders, medicalOrders, targets, guard };
}

test("medical original order resolves the real appointment before extra input identifiers", async () => {
	const f = await fixture();
	const service = f.guard.medical(
		{
			async query(input: unknown) {
				return input;
			},
		},
		["query"],
	);
	const input = {
		ownerUserId: owner,
		orderId: medicalOrderId,
		appointmentId: "another-appointment",
		businessType: "outpatient",
		recordId: "untrusted-record",
		skipLock: true,
	};
	expect(await service.query(input)).toBe(input);
	expect(f.targets).toEqual([{ ownerUserId: owner, appointmentId }]);
});

test("ordinary selfpay order resolves server-owned registration key before extra appointment input", async () => {
	const f = await fixture();
	const service = f.guard.selfPayOrder(
		{
			async query(input: unknown) {
				return input;
			},
		},
		["query"],
	);
	await service.query({
		ownerUserId: owner,
		orderId: cashOrderId,
		appointmentId: "another-appointment",
		skipLock: true,
	});
	expect(f.targets).toEqual([{ ownerUserId: owner, appointmentId }]);
});

test("plugin selfpay registration prefix follows its original medical order", async () => {
	const f = await fixture({
		cash: {
			...cash(),
			idempotencyKey: `registration-medical-plugin-self-pay:${medicalOrderId}`,
		},
	});
	const service = f.guard.selfPayOrder(
		{
			async query(_input: unknown) {
				return "ok";
			},
		},
		["query"],
	);
	await service.query({
		ownerUserId: owner,
		orderId: cashOrderId,
		appointmentId: "not-the-original",
	});
	expect(f.targets).toEqual([{ ownerUserId: owner, appointmentId }]);
});

test("legacy medical registration without businessId uses persisted appointmentId", async () => {
	const order = medical();
	delete order.businessType;
	delete order.businessId;
	const f = await fixture({ medical: order });
	const service = f.guard.medical({ async query(_input: unknown) {} }, [
		"query",
	]);
	await service.query({ ownerUserId: owner, orderId: medicalOrderId });
	expect(f.targets).toEqual([{ ownerUserId: owner, appointmentId }]);
});

test.each(["medical", "selfPayOrder"] as const)(
	"%s refuses to resolve another owner's original order into a registration lock",
	async (kind) => {
		const f = await fixture();
		const service = f.guard[kind](
			{
				async query(_input: unknown) {
					return "underlying-service-must-validate-owner";
				},
			},
			["query"],
		);
		await service.query({
			ownerUserId: "another-owner",
			orderId: kind === "medical" ? medicalOrderId : cashOrderId,
			appointmentId: "attacker-selected-appointment",
		});
		expect(f.targets).toEqual([]);
	},
);

test("plugin prefix cannot use another owner's medical registration", async () => {
	const f = await fixture({
		medical: { ...medical(), ownerUserId: "another-owner" },
		cash: {
			...cash(),
			idempotencyKey: `registration-medical-plugin-self-pay:${medicalOrderId}`,
		},
	});
	const service = f.guard.selfPayOrder({ async query(_input: unknown) {} }, [
		"query",
	]);
	await service.query({ ownerUserId: owner, orderId: cashOrderId });
	expect(f.targets).toEqual([]);
});

test.each(["medical", "selfPayOrder"] as const)(
	"missing %s original order never falls back to an extra appointmentId",
	async (kind) => {
		const f = await fixture();
		const service = f.guard[kind]({ async query(_input: unknown) {} }, [
			"query",
		]);
		await service.query({
			ownerUserId: owner,
			orderId: "missing-original-order",
			appointmentId,
		});
		expect(f.targets).toEqual([]);
	},
);

test.each([
	{ businessType: "outpatient" as const, orderType: "RegPay" as const },
	{ businessType: "registration" as const, orderType: "DiagPay" as const },
])(
	"persisted outpatient medical facts skip registration lock: %j",
	async (patch) => {
		const f = await fixture({ medical: { ...medical(), ...patch } });
		const service = f.guard.medical(
			{
				async query(_input: unknown) {
					return "outpatient";
				},
			},
			["query"],
		);
		expect(
			await service.query({
				ownerUserId: owner,
				orderId: medicalOrderId,
				appointmentId,
			}),
		).toBe("outpatient");
		expect(f.targets).toEqual([]);
	},
);

test.each([
	{ ownerUserId: owner, businessType: "outpatient", appointmentId },
	{ ownerUserId: owner, recordId: "outpatient-fee-record", appointmentId },
])(
	"extra outpatient markers cannot skip a valid registration appointment lock: %j",
	async (input) => {
		const f = await fixture();
		const service = f.guard.medical({ async authorize(_input: unknown) {} }, [
			"authorize",
		]);
		await service.authorize(input);
		expect(f.targets).toEqual([{ ownerUserId: owner, appointmentId }]);
	},
);

test("new registration authorization acquires owner and appointment lock", async () => {
	const f = await fixture();
	const service = f.guard.medical(
		{
			async authorize(_input: unknown) {
				return "authorized";
			},
		},
		["authorize"],
	);
	expect(await service.authorize({ ownerUserId: owner, appointmentId })).toBe(
		"authorized",
	);
	expect(f.targets).toEqual([{ ownerUserId: owner, appointmentId }]);
});

test.each([
	"outpatient-self-pay:fixture-record",
	"registration-self-pay:",
	"registration-medical-plugin-self-pay:",
	"other-payment-key",
])(
	"only valid persisted registration payment prefixes lock: %s",
	async (idempotencyKey) => {
		const f = await fixture({ cash: { ...cash(), idempotencyKey } });
		const service = f.guard.selfPayOrder({ async query(_input: unknown) {} }, [
			"query",
		]);
		await service.query({
			ownerUserId: owner,
			orderId: cashOrderId,
			appointmentId,
		});
		expect(f.targets).toEqual([]);
	},
);

test("plugin selfpay for an outpatient medical order never becomes registration", async () => {
	const f = await fixture({
		medical: { ...medical(), businessType: "outpatient", orderType: "DiagPay" },
		cash: {
			...cash(),
			idempotencyKey: `registration-medical-plugin-self-pay:${medicalOrderId}`,
		},
	});
	const service = f.guard.selfPayOrder({ async query(_input: unknown) {} }, [
		"query",
	]);
	await service.query({ ownerUserId: owner, orderId: cashOrderId });
	expect(f.targets).toEqual([]);
});

test.each(["appointment", "medical", "selfPayOrder"] as const)(
	"missing durable lock fails closed for %s registration commands",
	async (kind) => {
		const f = await fixture({ lock: false });
		let calls = 0;
		const service = f.guard[kind](
			{
				async write(_input: unknown) {
					calls++;
				},
			},
			["write"],
		);
		await expect(
			service.write({
				ownerUserId: owner,
				appointmentId,
				orderId: kind === "medical" ? medicalOrderId : cashOrderId,
			}),
		).rejects.toBeInstanceOf(DependencyNotConfiguredError);
		expect(calls).toBe(0);
	},
);

test("outpatient original order still executes when registration locking is unavailable", async () => {
	const f = await fixture({
		lock: false,
		medical: { ...medical(), businessType: "outpatient", orderType: "DiagPay" },
	});
	const service = f.guard.medical(
		{
			async query(_input: unknown) {
				return "outpatient-result";
			},
		},
		["query"],
	);
	expect(
		await service.query({ ownerUserId: owner, orderId: medicalOrderId }),
	).toBe("outpatient-result");
});

test("real repository lock held by administrator cancellation blocks authorization and payment gateways", async () => {
	const f = await fixture();
	const entered = deferred();
	const release = deferred();
	let gatewayCalls = 0;
	const assertBookable = async () => {
		if (
			(await f.appointments.findRegistration(owner, appointmentId))?.status !==
			"booked"
		)
			throw new Error("appointment-no-longer-booked");
		gatewayCalls++;
	};
	const medicalService = f.guard.medical(
		{
			async authorize(_input: unknown) {
				await assertBookable();
			},
		},
		["authorize"],
	);
	const cashService = f.guard.appointment(
		{
			async create(_input: unknown) {
				await assertBookable();
			},
		},
		["create"],
	);
	const cancelling = f.appointments.withCancellationLock?.(
		owner,
		appointmentId,
		async () => {
			entered.resolve();
			await release.promise;
			await f.appointments.updateRegistration(
				{ ...registration(), status: "cancelled" },
				"booked",
			);
		},
	);
	await entered.promise;
	await expect(
		medicalService.authorize({ ownerUserId: owner, appointmentId }),
	).rejects.toBeInstanceOf(AppointmentCancellationBusyError);
	await expect(
		cashService.create({ ownerUserId: owner, appointmentId }),
	).rejects.toBeInstanceOf(AppointmentCancellationBusyError);
	expect(gatewayCalls).toBe(0);
	release.resolve();
	await cancelling;
	await expect(
		medicalService.authorize({ ownerUserId: owner, appointmentId }),
	).rejects.toThrow("appointment-no-longer-booked");
	await expect(
		cashService.create({ ownerUserId: owner, appointmentId }),
	).rejects.toThrow("appointment-no-longer-booked");
	expect(gatewayCalls).toBe(0);
});

test("real repository payment lock prevents cancellation and cancellation then rechecks successful payment", async () => {
	const f = await fixture();
	const entered = deferred();
	const release = deferred();
	let paid = false;
	let cancellationCalls = 0;
	const payment = f.guard.selfPayOrder(
		{
			async query(_input: unknown) {
				entered.resolve();
				await release.promise;
				paid = true;
			},
		},
		["query"],
	);
	const cancellation = f.guard.appointment(
		{
			async cancel(_input: unknown) {
				if (paid) throw new Error("original-payment-paid");
				cancellationCalls++;
			},
		},
		["cancel"],
	);
	const paying = payment.query({
		ownerUserId: owner,
		orderId: cashOrderId,
		appointmentId: "irrelevant-extra-id",
	});
	await entered.promise;
	await expect(
		cancellation.cancel({ ownerUserId: owner, appointmentId }),
	).rejects.toBeInstanceOf(AppointmentCancellationBusyError);
	expect(cancellationCalls).toBe(0);
	release.resolve();
	await paying;
	await expect(
		cancellation.cancel({ ownerUserId: owner, appointmentId }),
	).rejects.toThrow("original-payment-paid");
	expect(cancellationCalls).toBe(0);
});

test("real repository trusted reentry supports nested original-medical and plugin operations", async () => {
	const f = await fixture({
		cash: {
			...cash(),
			idempotencyKey: `registration-medical-plugin-self-pay:${medicalOrderId}`,
		},
	});
	let gatewayCalls = 0;
	const plugin = f.guard.selfPayOrder(
		{
			async query(input: unknown) {
				gatewayCalls++;
				return input;
			},
		},
		["query"],
	);
	const medicalService = f.guard.medical(
		{
			async confirm(_input: unknown) {
				return plugin.query({ ownerUserId: owner, orderId: cashOrderId });
			},
		},
		["confirm"],
	);
	const result = await medicalService.confirm({
		ownerUserId: owner,
		orderId: medicalOrderId,
	});
	expect(result).toEqual({ ownerUserId: owner, orderId: cashOrderId });
	expect(gatewayCalls).toBe(1);
	expect(f.targets).toEqual([
		{ ownerUserId: owner, appointmentId },
		{ ownerUserId: owner, appointmentId },
	]);
});

test("different appointment continues while administrator owns another appointment lock", async () => {
	const f = await fixture();
	const entered = deferred();
	const release = deferred();
	const cancelling = f.appointments.withCancellationLock?.(
		owner,
		appointmentId,
		async () => {
			entered.resolve();
			await release.promise;
		},
	);
	await entered.promise;
	let calls = 0;
	const service = f.guard.appointment(
		{
			async create(_input: unknown) {
				calls++;
				return "independent";
			},
		},
		["create"],
	);
	expect(
		await service.create({
			ownerUserId: owner,
			appointmentId: "another-appointment",
		}),
	).toBe("independent");
	expect(calls).toBe(1);
	release.resolve();
	await cancelling;
});

test("service failure releases the real operation lock and preserves the original error", async () => {
	const f = await fixture();
	const failure = new Error("provider-outcome-unknown");
	let calls = 0;
	const service = f.guard.medical(
		{
			async query(_input: unknown) {
				calls++;
				if (calls === 1) throw failure;
				return "retry-observation";
			},
		},
		["query"],
	);
	await expect(
		service.query({ ownerUserId: owner, orderId: medicalOrderId }),
	).rejects.toBe(failure);
	expect(
		await service.query({ ownerUserId: owner, orderId: medicalOrderId }),
	).toBe("retry-observation");
});

test("scope never injects a client-visible or Provider-visible reentry marker", async () => {
	const f = await fixture();
	const input = {
		ownerUserId: owner,
		orderId: medicalOrderId,
		skipLock: true,
		reentrant: true,
		context: { traceId: "fixture-context" },
	};
	const snapshot = structuredClone(input);
	const service = f.guard.medical(
		{
			async query(value: unknown) {
				return value;
			},
		},
		["query"],
	);
	expect(await service.query(input)).toBe(input);
	expect(input).toEqual(snapshot);
	expect(f.targets).toEqual([{ ownerUserId: owner, appointmentId }]);
});
