import { expect, test } from "bun:test";
import { createZhongyangPatientGateway } from "@hospital/adapters";
import type { PatientRepository } from "@hospital/domain";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
} from "@hospital/persistence";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { createInMemorySessionTokenService } from "../auth/service";
import { patientsModule } from "./index";
import { PatientService } from "./service";

async function syntheticEmptyPatientApi(
	code: number | string,
	existing = false,
) {
	const identities = createInMemoryIdentityUserRepository();
	const identity = await identities.findOrCreateByWechat({
		providerSubject: "synthetic-empty-patient-subject",
		unionId: "synthetic-empty-patient-union",
	});
	const baseRepository = createInMemoryPatientRepository(
		existing
			? [
					{
						id: "synthetic-existing-patient",
						ownerUserId: identity.userId,
						displayName: "合成已有就诊人",
						relationship: "self",
						cardNumberMasked: "******0000",
						source: "hospital-his",
						clinicalAccess: "ready",
					},
				]
			: [],
	);
	const initialPatients = await baseRepository.listByOwner(identity.userId);
	const applySnapshot = baseRepository.replaceDirectorySnapshot;
	if (!applySnapshot) throw new Error("Missing snapshot test repository");
	let snapshotCommits = 0;
	let providerCalls = 0;
	const repository: PatientRepository = {
		...baseRepository,
		async replaceDirectorySnapshot(input) {
			snapshotCommits += 1;
			return applySnapshot.call(baseRepository, input);
		},
	};
	const directory = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			providerCalls += 1;
			expect(new URL(String(input)).pathname).toBe(
				"/api/public/patientInfoByUnionId",
			);
			return new Response(
				JSON.stringify({ success: false, code, msg: "数据未找到", data: null }),
				{
					status: 200,
					headers: { "x-request-id": "synthetic-empty-directory-http" },
				},
			);
		},
	});
	const service = new PatientService(repository, {
		identityUsers: identities,
		directory,
	});
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue(identity.userId);
	const app = new Elysia()
		.use(errorHandlerPlugin())
		.use(patientsModule(service, {} as never, sessions));
	return {
		app,
		repository,
		initialPatients,
		ownerUserId: identity.userId,
		providerCalls: () => providerCalls,
		snapshotCommits: () => snapshotCommits,
		headers: {
			Authorization: `Bearer ${issued.accessToken}`,
			"x-request-id": "synthetic-empty-directory-request",
			"idempotency-key": "synthetic-empty-directory-sync",
		},
	};
}

test("5001无就诊人账号的GET与显式同步返回200空目录并提交合法空快照", async () => {
	for (const code of [5001, "5001"]) {
		const fixture = await syntheticEmptyPatientApi(code);
		for (const [method, path] of [
			["GET", "/patients"],
			["POST", "/patients/sync"],
		] as const) {
			const response = await fixture.app.handle(
				new Request(`http://localhost${path}`, {
					method,
					headers: fixture.headers,
				}),
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				success: true,
				data: { items: [], total: 0 },
			});
		}
		expect(fixture.providerCalls()).toBe(2);
		expect(fixture.snapshotCommits()).toBe(2);
		expect(await fixture.repository.listByOwner(fixture.ownerUserId)).toEqual(
			[],
		);
	}
});

test("5001空结果不能清空已有医院目录，GET与同步保留原有保护错误", async () => {
	const fixture = await syntheticEmptyPatientApi(5001, true);
	for (const [method, path] of [
		["GET", "/patients"],
		["POST", "/patients/sync"],
	] as const) {
		const response = await fixture.app.handle(
			new Request(`http://localhost${path}`, {
				method,
				headers: fixture.headers,
			}),
		);
		expect(response.status).toBe(502);
		expect(await response.json()).toMatchObject({
			success: false,
			error: { code: "patient-directory-snapshot-unsafe" },
		});
	}
	expect(fixture.providerCalls()).toBe(2);
	expect(fixture.snapshotCommits()).toBe(0);
	expect(fixture.initialPatients).toHaveLength(1);
	expect(await fixture.repository.listByOwner(fixture.ownerUserId)).toEqual(
		fixture.initialPatients,
	);
});

test("患者二维码接口只返回服务端生成的图片并设置 no-store", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("fixture-patient-qr-owner");
	const patientService = {
		async getPatientQrCardNumber() {
			return "000012345678";
		},
	} as never;
	const app = patientsModule(patientService, {} as never, sessions);

	const response = await app.handle(
		new Request("http://localhost/patients/fixture-patient-qr-001/qr", {
			headers: {
				Authorization: `Bearer ${issued.accessToken}`,
				"x-request-id": "patient-qr-http-001",
			},
		}),
	);
	const payload = (await response.json()) as {
		success: boolean;
		data?: { imageDataUrl?: string };
	};

	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(payload.success).toBe(true);
	expect(payload.data?.imageDataUrl).toMatch(
		/^data:image\/gif;base64,[A-Za-z0-9+/=]+$/u,
	);
});
