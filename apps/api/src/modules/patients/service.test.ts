import { expect, test } from "bun:test";
import type { PatientDirectoryGateway } from "@hospital/domain";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
} from "@hospital/persistence";
import { PatientService } from "./service";

test("患者目录快照使用 provider 请求发起时间，避免乱序响应覆盖新快照", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-order",
		unionId: "fixture-union-patient-order",
	});
	const repository = createInMemoryPatientRepository();
	let providerRequestStarted = false;
	let nowCalls = 0;
	const directory: PatientDirectoryGateway = {
		listByIdentity: async () => {
			providerRequestStarted = true;
			return {
				complete: true,
				patients: [
					{
						providerPatientId: "provider-patient-order",
						displayName: "顺序患者",
						relationship: "self",
						cardNumberMasked: "******0001",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-order-request",
				},
			};
		},
	};

	const service = new PatientService(repository, {
		identityUsers,
		directory,
		now: () => {
			// 如果时间是在 provider 返回后才采样，本断言会在真实竞态位置失败。
			expect(providerRequestStarted).toBe(false);
			nowCalls += 1;
			return new Date("2026-08-16T00:00:00.000Z");
		},
		createPatientId: () => "internal-patient-order",
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-order-trace",
			idempotencyKey: "patient-order-key",
		}),
	).resolves.toMatchObject({ total: 1 });
	expect(nowCalls).toBe(1);
});
