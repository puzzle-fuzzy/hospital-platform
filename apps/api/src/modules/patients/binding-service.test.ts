import { expect, test } from "bun:test";
import type { PatientBindingGateway } from "@hospital/domain";
import type { PatientService } from "./service";
import {
	PatientBindingInputError,
	PatientBindingService,
} from "./binding-service";

const context = {
	traceId: "binding-service-trace-001",
	idempotencyKey: "binding-service-key-001",
};

test("患者绑定服务派生身份证事实并用独立同步幂等键刷新目录", async () => {
	let received: Record<string, unknown> | undefined;
	let syncKey = "";
	const gateway: PatientBindingGateway = {
		async bind(input) {
			received = input;
			return {
				created: true,
				trace: {
					provider: "zhongyang",
					operation: "patient-binding",
					requestId: "provider-binding-001",
				},
			};
		},
	};
	const patients = {
		async sync(_owner: string, syncContext: { idempotencyKey: string }) {
			syncKey = syncContext.idempotencyKey;
			return { items: [], total: 0 };
		},
	} as unknown as PatientService;
	const service = new PatientBindingService({ patients, gateway });

	await expect(
		service.bind(
			"fixture-owner-binding-001",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: true,
			},
			context,
		),
	).resolves.toMatchObject({ created: true, total: 0 });
	expect(received).toMatchObject({
		displayName: "张三",
		mobile: "13812345678",
		identityNumber: "11010519900101007X",
		birthDate: "1990-01-01",
		sex: "1",
	});
	expect(syncKey).toBe("binding-sync-binding-service-key-001");
});

test("患者绑定服务拒绝未同意或非法身份证且不调用下游", async () => {
	let gatewayCalls = 0;
	const gateway: PatientBindingGateway = {
		async bind() {
			gatewayCalls += 1;
			throw new Error("should not be called");
		},
	};
	const patients = {
		async sync() {
			throw new Error("should not be called");
		},
	} as unknown as PatientService;
	const service = new PatientBindingService({ patients, gateway });

	await expect(
		service.bind(
			"fixture-owner-binding-002",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: false,
			},
			context,
		),
	).rejects.toBeInstanceOf(PatientBindingInputError);
	await expect(
		service.bind(
			"fixture-owner-binding-002",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "not-an-id",
				consent: true,
			},
			context,
		),
	).rejects.toBeInstanceOf(PatientBindingInputError);
	expect(gatewayCalls).toBe(0);
});
