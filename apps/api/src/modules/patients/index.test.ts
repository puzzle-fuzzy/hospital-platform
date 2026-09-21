import { expect, test } from "bun:test";
import { createInMemorySessionTokenService } from "../auth/service";
import { patientsModule } from "./index";

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
