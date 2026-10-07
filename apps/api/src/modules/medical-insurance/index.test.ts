import { expect, test } from "bun:test";
import { createInMemorySessionTokenService } from "../auth/service";
import { medicalInsuranceModule } from "./index";

test("医保业务恢复响应禁止缓存上一笔按钮状态", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("medical-recovery-no-store-owner");
	let recoveryCalls = 0;
	const registrationService = {
		async recoverBusinessOrder() {
			recoveryCalls += 1;
			return {
				orderId: "medical-recovery-no-store-001",
				status: "created",
				authorizationReady: false,
				authorizationPending: false,
				recoveryAllowed: true,
			};
		},
	} as never;
	const app = medicalInsuranceModule(
		registrationService,
		sessions,
		{} as never,
		{} as never,
	);
	const request = () =>
		app.handle(
			new Request(
				"http://localhost/payments/medical-insurance/business-recovery",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${issued.accessToken}`,
						"content-type": "application/json",
						"x-request-id": `medical-recovery-no-store-${recoveryCalls + 1}`,
					},
					body: JSON.stringify({
						businessType: "registration",
						businessId: "appointment-no-store-001",
						patientId: "patient-no-store-001",
					}),
				},
			),
		);

	const first = await request();
	const second = await request();

	expect(first.status).toBe(200);
	expect(first.headers.get("cache-control")).toBe("no-store");
	expect(second.status).toBe(200);
	expect(second.headers.get("cache-control")).toBe("no-store");
	expect(recoveryCalls).toBe(2);
});
