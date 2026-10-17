import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import {
	AdminRegistrationInputError,
	AdminRegistrationNotFoundError,
	AdminRegistrationUnavailableError,
} from "./registration-service";
import { adminRegistrationsModule } from "./registrations";

const registration = {
	appointmentId: "appointment-admin-test",
	localStatus: "booked" as const,
	hospitalStatus: "scheduled" as const,
	hospitalPaymentStatus: "pending" as const,
	checkedAt: "2026-10-17T04:00:00.000Z",
	cancellation: {
		allowed: true,
		mode: "cancel_only" as const,
		reason: "可以取消挂号",
	},
};
const operator = `admin-session:${"a".repeat(40)}`;
function fixture(error?: Error) {
	const reads: unknown[] = [];
	const writes: unknown[] = [];
	const app = new Elysia({ normalize: false }).use(errorHandlerPlugin()).use(
		adminRegistrationsModule(
			{
				async query(input) {
					reads.push(input);
					if (error) throw error;
					return { source: input.source, orderId: input.orderId, registration };
				},
				async cancel(input) {
					writes.push(input);
					if (error) throw error;
					return {
						source: input.source,
						orderId: input.orderId,
						registration,
						outcome: "cancelled" as const,
					};
				},
			},
			"admin-registration-test-token",
		),
	);
	return {
		reads,
		writes,
		request: (
			method = "GET",
			body?: unknown,
			headers: Record<string, string> = {},
			path = "payment_order/payment-admin-test",
		) => {
			return app.handle(
				new Request(
					`http://localhost/admin/registrations/${path}${method === "POST" ? "/cancel" : ""}`,
					{
						method,
						headers: {
							"content-type": "application/json",
							"x-admin-refund-token": "admin-registration-test-token",
							"x-admin-operator-ref": operator,
							"x-request-id": "admin-registration-read-test",
							"idempotency-key": "admin-registration-cancel-test",
							...headers,
						},
						...(body !== undefined ? { body: JSON.stringify(body) } : {}),
					},
				),
			);
		},
	};
}

test("Admin 挂号状态 GET 仅调用专用状态查询并传可信操作人", async () => {
	const f = fixture();
	const response = await f.request();
	expect(response.status).toBe(200);
	expect((await response.json()).data.registration.hospitalStatus).toBe(
		"scheduled",
	);
	expect(f.reads).toEqual([
		{
			source: "payment_order",
			orderId: "payment-admin-test",
			operatorRef: operator,
			context: {
				traceId: "admin-registration-read-test",
				idempotencyKey: "admin-registration-cancel-test",
			},
		},
	]);
	expect(f.writes).toEqual([]);
});

test("Admin 取消命令只接收来源订单与原因，不允许覆盖 owner/患者/HIS 引用", async () => {
	const f = fixture();
	expect((await f.request("POST", { reason: "管理员协助取消" })).status).toBe(
		200,
	);
	expect(f.writes).toHaveLength(1);
	expect(f.writes[0]).toMatchObject({
		source: "payment_order",
		orderId: "payment-admin-test",
		reason: "管理员协助取消",
		operatorRef: operator,
	});
	for (const extra of [
		"ownerUserId",
		"patientId",
		"appointmentId",
		"providerAppointmentId",
		"refundFen",
		"operatorRef",
	]) {
		expect(
			(
				await f.request("POST", {
					reason: "管理员协助取消",
					[extra]: "injected",
				})
			).status,
		).toBe(400);
	}
	expect(f.writes).toHaveLength(1);
});

test("无管理令牌、操作人或取消幂等键的请求均不进入服务", async () => {
	const f = fixture();
	expect(
		(
			await f.request(
				"POST",
				{ reason: "协助取消" },
				{ "x-admin-refund-token": "wrong" },
			)
		).status,
	).toBe(401);
	expect(
		(
			await f.request("GET", undefined, {
				"x-admin-operator-ref": "forged-user",
			})
		).status,
	).toBe(400);
	expect(
		(await f.request("POST", { reason: "协助取消" }, { "idempotency-key": "" }))
			.status,
	).toBe(400);
	expect(f.reads).toEqual([]);
	expect(f.writes).toEqual([]);
});

test("原因、来源和订单路径严格校验", async () => {
	const f = fixture();
	for (const reason of ["", "x", "x".repeat(81)])
		expect((await f.request("POST", { reason })).status).toBe(400);
	expect(
		(await f.request("GET", undefined, {}, "outpatient/payment-admin-test"))
			.status,
	).toBe(400);
	expect(
		(await f.request("GET", undefined, {}, "medical_insurance/invalid%20order"))
			.status,
	).toBe(400);
	expect(f.reads).toEqual([]);
	expect(f.writes).toEqual([]);
});

for (const [error, status] of [
	[new AdminRegistrationNotFoundError(), 404],
	[new AdminRegistrationInputError("挂号参数不合法"), 400],
	[new AdminRegistrationUnavailableError("医院状态尚未确认，请先核对"), 409],
] as const) {
	test(`挂号服务 ${error.name} 映射为 ${status}`, async () => {
		const f = fixture(error);
		expect((await f.request("POST", { reason: "协助取消" })).status).toBe(
			status,
		);
	});
}
