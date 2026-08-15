import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	buildApiRequestUrl,
	isAllowedApiBaseUrl,
	isAllowedApiPrefix,
	normalizeApiBaseUrl,
	toWechatPaymentParams,
} from "../src/services/api-client";
import {
	createPastDateRange,
	createUpcomingDateRange,
	formatPlatformDate,
} from "../src/services/dashboard-service";
import { createLatestRequestGuard } from "../src/services/latest-request-guard";

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
	expect(service).toContain("clearSelectedPatientId");
	expect(home).toContain("clearSelectedPatientId");
	expect(selection).toContain("clearSelectedPatientId");
	// 选择页只能处理平台 opaque patientId，不得出现 provider 患者字段。
	expect(selection).not.toContain("providerPatientId");
	expect(selection).not.toContain("unionId");
});

test("native mini program build guards the DevTools TypeScript configuration", async () => {
	const config = await source("../project.config.json");
	const build = await Bun.file(
		join(import.meta.dir, "..", "scripts", "build.ts"),
	).text();

	expect(config).toContain('"miniprogramRoot": "dist/"');
	expect(config).toContain('"useCompilerPlugins": ["typescript"]');
	expect(build).toContain("tsconfig.build.json");
	expect(build).toContain("report-directory/report-directory.js");
	expect(build).toContain("src 仍是唯一业务源码");
});

test("native mini program exposes read-only appointment directory and records pages", async () => {
	const app = await source("app.json");
	const home = await source("pages/index/index.ts");
	const directory = await source(
		"pages/appointment-directory/appointment-directory.ts",
	);
	const records = await source(
		"pages/appointment-records/appointment-records.ts",
	);
	const directoryTemplate = await source(
		"pages/appointment-directory/appointment-directory.wxml",
	);
	const recordsTemplate = await source(
		"pages/appointment-records/appointment-records.wxml",
	);

	expect(app).toContain('"pages/appointment-directory/appointment-directory"');
	expect(app).toContain('"pages/appointment-records/appointment-records"');
	expect(home).toContain(
		'url: "/pages/appointment-directory/appointment-directory"',
	);
	expect(home).toContain(
		'url: "/pages/appointment-records/appointment-records"',
	);
	expect(home).not.toContain("预约下单功能仍在迁移中");
	expect(directory).toContain("loadAppointmentDepartments");
	expect(directory).toContain("loadDepartmentSchedules");
	expect(directory).toContain("scheduleGuard");
	expect(directory).toContain("directoryGuard");
	expect(directory).toContain("旧科室的排班覆盖当前选择");
	expect(records).toContain("loadAppointmentRecords");
	expect(records).toContain("getSelectedPatientId");
	expect(directoryTemplate).toContain("未来 7 天");
	expect(directoryTemplate).toContain("cascade-shell");
	expect(directoryTemplate).toContain("加载更多号源");
	expect(directoryTemplate).toContain("预约下单、锁号、取消和支付");
	expect(recordsTemplate).toContain("更换就诊人");
	expect(recordsTemplate).toContain("取消、退号和支付状态处理");
	// 预约写入、provider 患者标识和支付字段均不得进入小程序页面。
	expect(directory).not.toContain("providerPatientId");
	expect(records).not.toContain("providerPatientId");
	expect(records).not.toContain("wx.requestPayment");
});

test("native mini program exposes outpatient payment and my pages through platform APIs", async () => {
	const app = await source("app.json");
	const client = await source("services/api-client.ts");
	const home = await source("pages/index/index.ts");
	const outpatient = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);
	const outpatientTemplate = await source(
		"pages/outpatient-payment/outpatient-payment.wxml",
	);
	const my = await source("pages/my/my.ts");
	const myTemplate = await source("pages/my/my.wxml");

	expect(app).toContain('"pages/outpatient-payment/outpatient-payment"');
	expect(app).toContain('"pages/my/my"');
	expect(client).toContain("requestOutpatientPaymentRecords");
	expect(client).toContain("/payments/outpatient/records?");
	expect(home).toContain('url: "/pages/outpatient-payment/outpatient-payment"');
	expect(home).toContain('url: "/pages/my/my"');
	expect(outpatient).toContain("loadOutpatientPaymentRecords");
	expect(outpatientTemplate).toContain("待缴费");
	expect(outpatientTemplate).toContain(
		"支付调起、医保授权和结算回写将在独立业务契约验收后开放",
	);
	expect(my).toContain('url: "/pages/patient-select/patient-select"');
	expect(my).toContain('url: "/pages/appointment-records/appointment-records"');
	expect(myTemplate).toContain("家庭成员管理");
	expect(myTemplate).toContain("legacy-tabbar");
	// 小程序不能把 provider patId、provider 订单号或旧直连地址交给页面。
	expect(outpatient).not.toContain("providerPatientId");
	expect(outpatient).not.toContain("outTradeOrderId");
});

test("native mini program migrates the legacy static indoor navigation page", async () => {
	const app = await source("app.json");
	const home = await source("pages/index/index.ts");
	const page = await source("pages/hospital-navigation/hospital-navigation.ts");
	const template = await source(
		"pages/hospital-navigation/hospital-navigation.wxml",
	);
	const style = await source(
		"pages/hospital-navigation/hospital-navigation.wxss",
	);
	const asset = Bun.file(
		join(sourceRoot, "assets", "hospital-navigation", "map.jpg"),
	);

	expect(app).toContain('"pages/hospital-navigation/hospital-navigation"');
	expect(home).toContain('action: "hospital-navigation"');
	expect(home).toContain(
		'url: "/pages/hospital-navigation/hospital-navigation"',
	);
	expect(page).toContain("wx.previewImage");
	expect(page).toContain("地图加载失败");
	expect(template).toContain('mode="aspectFit"');
	expect(template).toContain("/assets/hospital-navigation/map.jpg");
	expect(style).toContain("#e8f2da");
	expect(await asset.exists()).toBe(true);
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
	const page = await source("pages/report-directory/report-directory.ts");
	const detail = await source("pages/report-detail/report-detail.ts");

	expect(service).toContain('Promise<ReportListResponse["data"]>');
	expect(page).toContain("reportCount: payload.total");
	expect(page).not.toContain("reportCount: 1");
	expect(detail).toContain("parseReportCount");
	expect(detail).not.toContain("reportCount: 1");
});

test("native homepage keeps patient identity and QR data within the safe boundary", async () => {
	const home = await source("pages/index/index.ts");
	const template = await source("pages/index/index.wxml");

	// 首页只能显示服务端脱敏卡号，内部 patientId 只作为后续 API 的 opaque 输入。
	expect(template).toContain("selectedPatient.cardNumberMasked");
	expect(template).not.toContain("ID:{{selectedPatient.id");
	expect(home).toContain("二维码暂未开放");
	expect(home).not.toContain("api.qrserver.com");
	expect(home).not.toContain("medicalCardNo");
});

test("native homepage routes patient binding and report query to real pages", async () => {
	const app = await source("app.json");
	const home = await source("pages/index/index.ts");
	const reportPage = await source("pages/report-directory/report-directory.ts");
	const reportTemplate = await source(
		"pages/report-directory/report-directory.wxml",
	);

	expect(app).toContain('"pages/report-directory/report-directory"');
	expect(home).toContain('action: "patient-select"');
	expect(home).toContain('url: "/pages/report-directory/report-directory"');
	expect(reportPage).toContain("loadReports");
	expect(reportPage).toContain("onLoadMore");
	expect(reportPage).toContain("setSelectedPatientId");
	expect(reportTemplate).toContain("报告查询");
	expect(reportTemplate).toContain("加载更多报告");
	// 报告详情只接受服务端生成的 opaque reportId，目录不透传 provider 报告号。
	expect(reportPage).not.toContain("providerReportId");
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
	const patientSelectTemplate = await source(
		"pages/patient-select/patient-select.wxml",
	);
	const patientSelectStyle = await source(
		"pages/patient-select/patient-select.wxss",
	);
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
	expect(homeStyle).toContain("justify-content: center");
	expect(patientSelectTemplate).toContain("relationshipLabel");
	expect(patientSelectTemplate).toContain("电子就诊卡（脱敏）");
	expect(patientSelectStyle).toContain("height: 80rpx");
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

test("page request guard only permits the latest patient read to update state", () => {
	const guard = createLatestRequestGuard();
	const first = guard.begin();
	const second = guard.begin();

	expect(guard.isCurrent(first)).toBe(false);
	expect(guard.isCurrent(second)).toBe(true);
});

test("patient-scoped pages guard stale asynchronous responses", async () => {
	const records = await source(
		"pages/appointment-records/appointment-records.ts",
	);
	const reports = await source("pages/report-directory/report-directory.ts");
	const payments = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);
	const selection = await source("pages/patient-select/patient-select.ts");
	const appointmentDirectory = await source(
		"pages/appointment-directory/appointment-directory.ts",
	);

	for (const page of [
		records,
		reports,
		payments,
		selection,
		appointmentDirectory,
	]) {
		expect(page).toContain("createLatestRequestGuard");
		expect(page).toContain("isCurrent");
	}
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
