import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	isAllowedApiBaseUrl,
	isAllowedApiPrefix,
	buildApiRequestUrl,
	normalizeApiBaseUrl,
	toWechatPaymentParams,
} from "../src/services/api-client";
import {
	createPastDateRange,
	createUpcomingDateRange,
	formatPlatformDate,
} from "../src/services/dashboard-service";

const sourceRoot = join(import.meta.dir, "..", "src");

async function source(file: string): Promise<string> {
	return Bun.file(join(sourceRoot, file)).text();
}

test("native client keeps WeChat identity exchange on the Hospital API", async () => {
	const client = await source("services/api-client.ts");
	const app = await source("app.ts");

	expect(client).toContain("wx.login");
	expect(client).toContain('url: "/auth/wechat"');
	expect(client).toContain("apiPrefix");
	expect(app).toContain('apiBaseUrl: "https://test-hp.meiyi.pro"');
	expect(app).toContain('apiPrefix: "/api/v2"');
	expect(client).not.toContain("/sns/jscode2session");
	expect(client).not.toContain("api.weixin.qq.com");
});

test("native client restores a platform session through the current-user endpoint", async () => {
	const client = await source("services/api-client.ts");
	const page = await source("pages/index/index.ts");

	expect(client).toContain("getCurrentUser");
	expect(client).toContain('url: "/me"');
	expect(page).toContain("验证会话中");
	expect(client).not.toContain("providerSubject");
});

test("native client sends request ids for Pino HTTP correlation", async () => {
	const client = await source("services/api-client.ts");

	expect(client).toContain('"x-request-id": requestId');
	expect(client).toContain("responseRequestId(response)");
	expect(client).not.toContain('"authorization": requestId');
});

test("native client keeps health checks behind the versioned public prefix", () => {
	expect(
		buildApiRequestUrl("https://test-hp.meiyi.pro", "/api/v2", "/health/live"),
	).toBe("https://test-hp.meiyi.pro/api/v2/health/live");
});

test("native client requests server-generated prepay parameters", async () => {
	const client = await source("services/api-client.ts");

	expect(client).toContain("requestWechatPrepay");
	expect(client).toContain("/wechat-prepay");
	expect(client).toContain("getWechatPrepay");
	expect(client).toContain("launchWechatPayment");
	expect(client).toContain("wx.requestPayment");
	// 支付签名必须原样使用服务端返回值，避免小程序端自行生成或重签名。
	expect(client).toContain("const paySign = params.paySign");
	expect(client).not.toContain("paySign = sign");
});

test("native client requests patient synchronization through the Hospital API", async () => {
	const client = await source("services/api-client.ts");
	const page = await source("pages/index/index.ts");

	expect(client).toContain("syncPatients");
	expect(client).toContain('url: "/patients/sync"');
	expect(page).toContain("onSyncPatients");
	expect(page).not.toContain("unionId");
	expect(page).not.toContain("providerPatientId");
});

test("native mini program exposes a real patient selection page", async () => {
	const app = await source("app.json");
	const home = await source("pages/index/index.ts");
	const selection = await source("pages/patient-select/patient-select.ts");
	const template = await source("pages/patient-select/patient-select.wxml");
	const service = await source("services/patient-selection-service.ts");

	expect(app).toContain('"pages/patient-select/patient-select"');
	expect(home).toContain("openPatientSelector");
	expect(home).toContain('url: "/pages/patient-select/patient-select"');
	expect(home).not.toContain("wx.showActionSheet");
	expect(home).toContain("onShow()");
	expect(selection).toContain("loadPatients");
	expect(selection).toContain("onPatientTap");
	expect(selection).toContain("setSelectedPatientId");
	expect(template).toContain("patient-card-selected");
	expect(template).toContain("刷新就诊人");
	expect(service).toContain('SELECTED_PATIENT_ID_KEY = "selected_patient_id"');
	expect(service).toContain("wx.setStorageSync");
	// 选择页只能处理平台 opaque patientId，不得出现 provider 患者字段。
	expect(selection).not.toContain("providerPatientId");
	expect(selection).not.toContain("unionId");
});

test("native client reads appointment directories only through the Hospital API", async () => {
	const client = await source("services/api-client.ts");
	const page = await source("pages/index/index.ts");

	expect(client).toContain("requestAppointmentDepartments");
	expect(client).toContain('url: "/appointments/departments"');
	expect(client).toContain("requestAppointmentSchedules");
	expect(client).toContain("/appointments/schedules?");
	expect(page).toContain("onLoadAppointments");
	expect(page).not.toContain("msun-middle-business-amc-server");
});

test("native client reads appointment records by internal patient id through the Hospital API", async () => {
	const client = await source("services/api-client.ts");
	const page = await source("pages/index/index.ts");
	const template = await source("pages/index/index.wxml");

	expect(client).toContain("requestAppointmentRecords");
	expect(client).toContain("/appointments/records?");
	expect(client).toContain("patientId=");
	expect(page).toContain("onLoadAppointmentRecords");
	expect(page).toContain("getSelectedPatient");
	expect(template).toContain("selectedPatient.displayName");
	expect(template).toContain("onHeroAction");
	expect(page).not.toContain("msun-middle-business-appointment-server");
	expect(page).not.toContain("providerPatientId");
});

test("native client reads report directories by internal patient id through the Hospital API", async () => {
	const client = await source("services/api-client.ts");
	const page = await source("pages/index/index.ts");

	expect(client).toContain("requestReports");
	expect(client).toContain("/reports?");
	expect(client).toContain("patientId=");
	expect(page).toContain("onLoadReports");
	expect(page).not.toContain("msun-middle-business-lis");
	expect(page).not.toContain("providerPatientId");
});

test("native report count comes from the report directory total", async () => {
	const service = await source("services/dashboard-service.ts");
	const page = await source("pages/index/index.ts");
	const detail = await source("pages/report-detail/report-detail.ts");

	expect(service).toContain('Promise<ReportListResponse["data"]>');
	expect(page).toContain("reportCount: reports.total");
	expect(page).not.toContain("reportCount: 1");
	expect(detail).toContain("parseReportCount");
	expect(detail).not.toContain("reportCount: 1");
});

test("native client reads LIS detail only through the opaque Hospital API reference", async () => {
	const client = await source("services/api-client.ts");

	expect(client).toContain("requestReportDetail");
	expect(client).toContain(`/reports/\${encodeURIComponent(reportId)}`);
	expect(client).not.toContain("lis-reports/details");
	expect(client).not.toContain("providerReportId");
});

test("native client only permits local HTTP or HTTPS API addresses", () => {
	expect(isAllowedApiBaseUrl("http://127.0.0.1:3000")).toBe(true);
	expect(isAllowedApiBaseUrl("http://localhost:3000/api")).toBe(true);
	expect(isAllowedApiBaseUrl("https://hospital.example.test/api")).toBe(true);
	expect(isAllowedApiBaseUrl("https://")).toBe(false);
	expect(isAllowedApiBaseUrl("http://hospital.example.test/api")).toBe(false);
	expect(isAllowedApiBaseUrl("ftp://hospital.example.test")).toBe(false);
	expect(isAllowedApiBaseUrl("")).toBe(false);
	expect(normalizeApiBaseUrl("https://hospital.example.test/api/v1")).toBe(
		"https://hospital.example.test",
	);
	expect(normalizeApiBaseUrl("http://127.0.0.1:3000/api/v1")).toBe(
		"http://127.0.0.1:3000",
	);
	expect(isAllowedApiPrefix("/api/v1")).toBe(true);
	expect(isAllowedApiPrefix("/api/v2")).toBe(true);
	expect(isAllowedApiPrefix("/api/v1/auth")).toBe(false);
});

test("native mini program keeps the legacy hospital visual system", async () => {
	const globalStyle = await source("app.wxss");
	const homeTemplate = await source("pages/index/index.wxml");
	const homeStyle = await source("pages/index/index.wxss");
	const reportTemplate = await source("pages/report-detail/report-detail.wxml");
	const reportStyle = await source("pages/report-detail/report-detail.wxss");

	expect(globalStyle).toContain("--hospital-primary: #3d6df6");
	expect(globalStyle).toContain("--hospital-primary-strong: #4b8eff");
	expect(globalStyle).toContain("--hospital-canvas: #f5f5f5");
	expect(globalStyle).toContain("--hospital-nav: #f8f8f8");
	expect(homeTemplate).toContain("patient-card");
	expect(homeTemplate).toContain("top-grid");
	expect(homeTemplate).toContain("quick-banner");
	expect(homeTemplate).toContain("service-tabs-shell");
	expect(homeTemplate).toContain("legacy-tabbar");
	expect(homeTemplate).toContain("微信已登录");
	expect(homeTemplate).toContain("/assets/legacy-home/patient-qr.svg");
	expect(homeTemplate.indexOf('class="error-message"')).toBeGreaterThanOrEqual(
		0,
	);
	expect(homeTemplate.indexOf('class="error-message"')).toBeLessThan(
		homeTemplate.indexOf('class="con-main patient-area"'),
	);
	expect(homeStyle).toContain("box-sizing: content-box");
	expect(homeStyle).not.toContain("background-image: url(");
	expect(homeTemplate).toContain(
		'src="/assets/legacy-home/patient-background.png"',
	);
	expect(homeStyle).toContain("padding: 25rpx 30rpx");
	expect(homeStyle).toContain("position: fixed");
	expect(homeStyle).toContain("bottom: 0");
	expect(homeStyle).toContain("env(safe-area-inset-bottom)");
	expect(homeStyle).toContain("width: 350rpx");
	expect(reportTemplate).toContain("report-actions");
	expect(reportTemplate).toContain("report-tabs-wrap");
	expect(reportTemplate).toContain("report-content");
	expect(reportTemplate).toContain("/assets/legacy-home/report-download.svg");
	expect(reportStyle).toContain(".bottom-action-wrap");
	expect(reportStyle).toContain("z-index: 30");
	expect(reportStyle).toContain("padding-bottom: env(safe-area-inset-bottom)");
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

test("dashboard service owns bounded date windows and internal patient inputs", async () => {
	const service = await source("services/dashboard-service.ts");

	expect(service).toContain("DASHBOARD_DATE_RANGE_DAYS");
	expect(service).toContain("appointmentDirectory: 7");
	expect(service).toContain("appointmentRecords: 90");
	expect(service).toContain("reports: 30");
	expect(service).toContain("requirePatientId");
	expect(service).not.toContain("providerPatientId");
	expect(service).not.toContain("msun-middle-business");
});

test("dashboard service calculates local platform date windows", () => {
	const now = new Date(2026, 7, 15, 23, 59, 59);

	expect(formatPlatformDate(now)).toBe("2026-08-15");
	expect(createPastDateRange(90, now)).toEqual({
		startDate: "2026-05-17",
		endDate: "2026-08-15",
	});
	expect(createUpcomingDateRange(7, now)).toEqual({
		startDate: "2026-08-15",
		endDate: "2026-08-22",
	});
});

test("native page delegates token state to the session service", async () => {
	const page = await source("pages/index/index.ts");
	const session = await source("services/session-service.ts");

	expect(page).toContain("hasPlatformSession");
	expect(page).not.toContain("globalData.accessToken");
	expect(page).not.toContain("globalData.sessionStatus");
	expect(session).toContain("getCurrentUser");
	expect(session).toContain("login");
});

test("native report detail page consumes only the opaque platform reference", async () => {
	const client = await source("services/api-client.ts");
	const page = await source("pages/report-detail/report-detail.ts");
	const template = await source("pages/report-detail/report-detail.wxml");

	expect(client).toContain("requestReportDetail");
	expect(page).toContain("requestReportDetail(reportId)");
	expect(page).toContain("report-detail-id-missing");
	expect(template).toContain("report-actions");
	expect(page).not.toContain("providerReportId");
	expect(page).not.toContain("fileUrl");
	expect(template).not.toContain("providerReportId");
});
