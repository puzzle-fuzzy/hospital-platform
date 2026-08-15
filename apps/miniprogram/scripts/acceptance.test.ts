import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	isAllowedApiBaseUrl,
	toWechatPaymentParams,
} from "../src/services/api-client.js";

const sourceRoot = join(import.meta.dir, "..", "src");

async function source(file: string): Promise<string> {
	return Bun.file(join(sourceRoot, file)).text();
}

test("native client keeps WeChat identity exchange on the Hospital API", async () => {
	const client = await source("services/api-client.js");

	expect(client).toContain("wx.login");
	expect(client).toContain("/api/v1/auth/wechat");
	expect(client).not.toContain("/sns/jscode2session");
	expect(client).not.toContain("api.weixin.qq.com");
});

test("native client restores a platform session through the current-user endpoint", async () => {
	const client = await source("services/api-client.js");
	const page = await source("pages/index/index.js");

	expect(client).toContain("getCurrentUser");
	expect(client).toContain('url: "/api/v1/me"');
	expect(page).toContain("验证会话中");
	expect(client).not.toContain("providerSubject");
});

test("native client requests server-generated prepay parameters", async () => {
	const client = await source("services/api-client.js");

	expect(client).toContain("requestWechatPrepay");
	expect(client).toContain("/wechat-prepay");
	expect(client).toContain("getWechatPrepay");
	expect(client).toContain("launchWechatPayment");
	expect(client).toContain("wx.requestPayment");
	expect(client).not.toContain("paySign =");
});

test("native client requests patient synchronization through the Hospital API", async () => {
	const client = await source("services/api-client.js");
	const page = await source("pages/index/index.js");

	expect(client).toContain("syncPatients");
	expect(client).toContain("/api/v1/patients/sync");
	expect(page).toContain("onSyncPatients");
	expect(page).not.toContain("unionId");
	expect(page).not.toContain("providerPatientId");
});

test("native client reads appointment directories only through the Hospital API", async () => {
	const client = await source("services/api-client.js");
	const page = await source("pages/index/index.js");

	expect(client).toContain("requestAppointmentDepartments");
	expect(client).toContain("/api/v1/appointments/departments");
	expect(client).toContain("requestAppointmentSchedules");
	expect(client).toContain("/api/v1/appointments/schedules?");
	expect(page).toContain("onLoadAppointments");
	expect(page).not.toContain("msun-middle-business-amc-server");
});

test("native client reads appointment records by internal patient id through the Hospital API", async () => {
	const client = await source("services/api-client.js");
	const page = await source("pages/index/index.js");

	expect(client).toContain("requestAppointmentRecords");
	expect(client).toContain("/api/v1/appointments/records?");
	expect(client).toContain("patientId=");
	expect(page).toContain("onLoadAppointmentRecords");
	expect(page).not.toContain("msun-middle-business-appointment-server");
	expect(page).not.toContain("providerPatientId");
});

test("native client reads report directories by internal patient id through the Hospital API", async () => {
	const client = await source("services/api-client.js");
	const page = await source("pages/index/index.js");

	expect(client).toContain("requestReports");
	expect(client).toContain("/api/v1/reports?");
	expect(client).toContain("patientId=");
	expect(page).toContain("onLoadReports");
	expect(page).not.toContain("msun-middle-business-lis");
	expect(page).not.toContain("providerPatientId");
});

test("native client only permits local HTTP or HTTPS API addresses", () => {
	expect(isAllowedApiBaseUrl("http://127.0.0.1:3000")).toBe(true);
	expect(isAllowedApiBaseUrl("http://localhost:3000/api")).toBe(true);
	expect(isAllowedApiBaseUrl("https://hospital.example.test/api")).toBe(true);
	expect(isAllowedApiBaseUrl("https://")).toBe(false);
	expect(isAllowedApiBaseUrl("http://hospital.example.test/api")).toBe(false);
	expect(isAllowedApiBaseUrl("ftp://hospital.example.test")).toBe(false);
	expect(isAllowedApiBaseUrl("")).toBe(false);
});

test("native client maps only the server payment fields", () => {
	const params = toWechatPaymentParams({
		data: {
			payParams: {
				appId: "wx-app",
				timeStamp: "1700000000",
				nonceStr: "nonce",
				package: "prepay_id=server-value",
				signType: "RSA",
				paySign: "server-signature",
				unexpected: "must-not-forward",
			},
		},
	});

	expect(params).toEqual({
		appId: "wx-app",
		timeStamp: "1700000000",
		nonceStr: "nonce",
		package: "prepay_id=server-value",
		signType: "RSA",
		paySign: "server-signature",
	});
	expect(
		toWechatPaymentParams({ data: { payParams: { signType: "RSA" } } }),
	).toBe(null);
});
