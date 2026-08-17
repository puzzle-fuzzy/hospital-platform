import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	ApiError,
	buildApiRequestUrl,
	CLIENT_ERROR_MESSAGES,
	isAllowedApiBaseUrl,
	isAllowedApiPrefix,
	localizedApiErrorMessage,
	normalizeApiBaseUrl,
	safeApiErrorMessage,
	toWechatPaymentParams,
} from "../src/services/api-client";
import {
	createAppointmentRecordDateRange,
	createPastDateRange,
	createUpcomingDateRange,
	formatPlatformDate,
} from "../src/services/dashboard-service";
import {
	LABORATORY_FLAG_LABELS,
	toLaboratoryReportItemView,
} from "../src/services/report-presenter";
import { createLatestRequestGuard } from "../src/services/latest-request-guard";
import { resolvePatientSelection } from "../src/services/patient-selection-service";
import type { Patient } from "../src/types";

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

test("native client single-flights login and preserves a newer concurrent token", async () => {
	const client = await source("services/api-client.ts");

	// 首页恢复、患者同步和业务页面可能同时触发会话请求；一次性 wx.login code
	// 只能由一个请求消费，旧 401 也不能清理并发请求刚换得的新 token。
	expect(client).toContain("loginInFlight");
	expect(client).toContain("const promise = performLogin()");
	expect(client).toContain("currentToken !== accessToken");
	expect(client).toContain(
		"return request<TResponse>({ ...options, authenticated: true })",
	);
	expect(client).toContain(
		'appData.sessionStatus = accessToken ? "signed_in" : "signed_out"',
	);
});

test("native client sends request ids for Pino HTTP correlation", async () => {
	const client = await source("services/api-client.ts");

	expect(client).toContain('"x-request-id": requestId');
	expect(client).toContain("responseRequestId(response)");
	expect(client).not.toContain('"authorization": requestId');
});

test("native client localizes every public query and session error boundary", () => {
	expect(localizedApiErrorMessage("patient-sync-in-progress", "fallback")).toBe(
		"患者目录正在同步，请稍后刷新",
	);
	expect(localizedApiErrorMessage("user-profile-conflict", "fallback")).toBe(
		"个人资料已被其他设备修改，请刷新后重试",
	);
	expect(
		localizedApiErrorMessage(
			"appointment-record-patient-not-found",
			"fallback",
		),
	).toBe("当前就诊人暂无可查询的预约记录");
	expect(localizedApiErrorMessage("report-not-found", "fallback")).toBe(
		"报告详情暂不可用",
	);
	expect(
		localizedApiErrorMessage("provider-request-rejected", "英文 provider 文案"),
	).toBe("外部服务拒绝了本次请求，请稍后重试");
	expect(localizedApiErrorMessage("unrecognized-code", "安全兜底")).toBe(
		"安全兜底",
	);
	expect(localizedApiErrorMessage("api-request-failed", "服务端原始错误")).toBe(
		"请求失败，请稍后重试",
	);
});

test("native report detail translates clinical flag enums at the display boundary", () => {
	expect(LABORATORY_FLAG_LABELS).toEqual({
		normal: "正常",
		high: "偏高",
		low: "偏低",
		critical: "危急",
		unknown: "待确认",
	});
	expect(
		toLaboratoryReportItemView({
			name: "白细胞",
			result: "10.2",
			flag: "high",
		}),
	).toEqual({
		name: "白细胞",
		result: "10.2",
		flag: "high",
		flagLabel: "偏高",
	});
});

test("native pages never display an unmapped ApiError message", async () => {
	// 页面展示必须按 code 取稳定文案；即使调用方误把 provider 原始文本放进
	// ApiError.message，也只能回退到安全的页面文案，不能把原文显示给患者。
	expect(
		safeApiErrorMessage(
			new ApiError("provider raw detail", {
				code: "provider-request-rejected",
			}),
			"页面兜底",
		),
	).toBe("外部服务拒绝了本次请求，请稍后重试");
	expect(
		safeApiErrorMessage(
			new ApiError("unknown internal detail", { code: "future-private-code" }),
			"页面兜底",
		),
	).toBe("页面兜底");

	const pagePaths = JSON.parse(await source("app.json")) as { pages: string[] };
	for (const pagePath of pagePaths.pages) {
		const page = await source(`${pagePath}.ts`);
		expect(page).not.toContain("error.message");
	}
});

test("native client error messages cover every code documented by the public API", async () => {
	const markdown = await Bun.file(
		join(import.meta.dir, "../../../docs/api-v2-public.md"),
	).text();
	const errorTable = markdown.split("## 5. 当前实现边界")[0] ?? "";
	const documentedCodes = new Set<string>();
	for (const line of errorTable.split("\n")) {
		if (!/^\| \d+ \|/.test(line)) continue;
		for (const match of line.matchAll(/`([a-z0-9-]+)`/g)) {
			const code = match[1];
			if (code) documentedCodes.add(code);
		}
	}

	expect(documentedCodes.size).toBeGreaterThan(0);
	for (const code of documentedCodes) {
		expect(CLIENT_ERROR_MESSAGES[code]).toBeString();
	}
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
	// 空目录不能清掉历史选择，否则恢复后会静默默认第一位；选择页只在
	// 用户明确点击患者时写入新 ID，会话失效由首页上下文清理负责。
	expect(selection).not.toContain("clearSelectedPatientId");
	// 选择页只能处理平台 opaque patientId，不得出现 provider 患者字段。
	expect(selection).not.toContain("providerPatientId");
	expect(selection).not.toContain("unionId");
});

test("patient selection never silently switches a stale patient to another patient", () => {
	const patientA = {
		id: "patient-a",
		displayName: "患者甲",
		relationship: "self",
		cardNumberMasked: "******0001",
		source: "hospital-his",
	} satisfies Patient;
	const patientB = {
		id: "patient-b",
		displayName: "患者乙",
		relationship: "child",
		cardNumberMasked: "******0002",
		source: "hospital-his",
	} satisfies Patient;
	const patients = [patientA, patientB];

	expect(resolvePatientSelection(patients, "")).toEqual({
		state: "defaulted",
		patient: patientA,
	});
	expect(resolvePatientSelection(patients, "patient-b")).toEqual({
		state: "selected",
		patient: patientB,
	});
	expect(resolvePatientSelection(patients, "patient-removed")).toEqual({
		state: "stale",
		storedPatientId: "patient-removed",
	});
	// 空目录也不能把已有选择改写成“从未选择”；目录恢复后必须进入 stale，
	// 而不是自动选择恢复列表的第一位。
	expect(resolvePatientSelection([], "patient-removed")).toEqual({
		state: "empty",
	});
});

test("native patient selection keeps unverified patient binding fail-closed", async () => {
	const selection = await source("pages/patient-select/patient-select.ts");
	const template = await source("pages/patient-select/patient-select.wxml");
	const bindingContract = await Bun.file(
		join(
			import.meta.dir,
			"../../../docs/migration/patient-binding-contract-draft.md",
		),
	).text();

	// provider 文档和最终状态查询未冻结前，页面只能给出迁移提示，不能产生
	// “查档失败后继续建档”的旧端副作用，也不能把医院患者号带回小程序。
	expect(selection).toContain("onAddPatient");
	expect(selection).toContain("医院绑定接口正在迁移中");
	expect(selection).not.toContain("getArchivesInfoApi");
	expect(selection).not.toContain("createPatientApi");
	expect(selection).not.toContain("bindCardApi");
	expect(template).toContain("添加就诊人");
	expect(template).toContain("真实绑定接口接入前只展示迁移提示");
	expect(bindingContract).toContain("查找异常不得转成“没有档案”");
	expect(bindingContract).toContain("PB-01");
});

test("patient selection cannot leave before clinical mapping synchronization completes", async () => {
	const selection = await source("pages/patient-select/patient-select.ts");

	// 平台目录已经返回时，医院侧 his-patient 映射仍可能在同步中；页面只能在
	// 完整同步成功后开放选择，失败时不能带着半成品患者上下文返回业务页。
	expect(selection).toContain("selectionReady: false");
	expect(selection).toContain(
		"this.data.loading || this.data.syncing || !this.data.selectionReady",
	);
	expect(selection).toContain(
		"this.setData({ selectionReady: patients.length > 0 });",
	);
	expect(selection).toContain("目录读取成功不等于医院侧临床映射已经完成");
});

test("native patient synchronization is single-flight at both entry pages", async () => {
	const home = await source("pages/index/index.ts");
	const selection = await source("pages/patient-select/patient-select.ts");

	// WXML disabled 只能降低重复点击概率，不能约束生命周期回调或真机重复事件。
	// 两个入口都必须在方法层复用同一个 Promise；跨进程最终幂等仍由服务端保证。
	expect(home).toContain("getPageSingleFlight<Array<Patient>>");
	expect(home).toContain("return patientSyncFlight.run(() => {");
	expect(selection).toContain("getPageSingleFlight<void>");
	expect(selection).toContain("return patientSyncFlight.run(() => {");
});

test("native data pages keep first-show state on the page instance", async () => {
	const pageFiles = [
		"pages/index/index.ts",
		"pages/appointment-records/appointment-records.ts",
		"pages/missed-appointments/missed-appointments.ts",
		"pages/report-directory/report-directory.ts",
		"pages/outpatient-payment/outpatient-payment.ts",
	] as const;

	for (const file of pageFiles) {
		const page = await source(file);
		// 模块级首次展示变量会被多个页面实例共享；这会让页面栈返回时
		// 漏掉必要刷新或额外刷新。每个页面必须在 data 中保存自己的状态。
		expect(page).toContain("hasShown: false");
		expect(page).toContain("if (!this.data.hasShown)");
		expect(page).toContain("this.setData({ hasShown: true })");
		expect(page).not.toContain("let isFirstShow");
	}
});

test("native my page separates ordinary profile from family patient selection", async () => {
	const app = await source("app.json");
	const my = await source("pages/my/my.ts");
	const template = await source("pages/my/my.wxml");
	const profile = await source("pages/profile/profile.ts");
	const profileTemplate = await source("pages/profile/profile.wxml");
	const client = await source("services/api-client.ts");
	const build = await Bun.file(join(import.meta.dir, "build.ts")).text();

	expect(app).toContain('"pages/profile/profile"');
	expect(my).toContain('url: "/pages/profile/profile"');
	expect(my).toContain('url: "/pages/patient-select/patient-select"');
	expect(template).toContain('bindtap="onFamilyTap"');
	expect(template).toContain('bindtap="onHeaderTap"');
	expect(template).toContain('data-action="electronic-consultation"');
	expect(template).toContain("电子导诊单");
	expect(template).toContain('data-action="smart-customer"');
	expect(template).toContain("智能客服");
	expect(my).toContain('case "electronic-consultation"');
	expect(my).toContain('case "smart-customer"');
	expect(my).toContain("医保电子凭证需要独立授权");
	expect(profile).toContain("getUserProfile");
	expect(profile).toContain("updateUserProfile");
	expect(profile).toContain("getPageLatestRequestGuard");
	expect(profile).toContain("profileLoadGuard.isCurrent(requestToken)");
	expect(profile).toContain("this.data.version");
	expect(profile).toContain("if (this.data.saving) return Promise.resolve();");
	expect(profile).toContain("尚未加载完成");
	expect(profile).not.toContain("openid");
	expect(profile).not.toContain("unionid");
	expect(profile).not.toContain("idCard");
	expect(profile).not.toContain("avatar");
	expect(profileTemplate).toContain("头像、手机号、真实姓名和身份证");
	expect(profileTemplate).toContain('disabled="{{saving || loading}}"');
	expect(client).toContain('url: "/me/profile"');
	expect(build).toContain("profile/profile.js");
});

test("native mini program build guards the DevTools TypeScript configuration", async () => {
	const config = await source("../project.config.json");
	const build = await Bun.file(
		join(import.meta.dir, "..", "scripts", "build.ts"),
	).text();

	expect(config).toContain('"miniprogramRoot": "dist/"');
	expect(config).toContain('"useCompilerPlugins": ["typescript"]');
	expect(build).toContain("tsconfig.build.json");
	expect(build).toContain("appPagePaths");
	expect(build).toContain("app.json page scripts are present");
	expect(build).toContain("report-directory/report-directory.js");
	expect(build).toContain("project.private.config.json");
	expect(build).toContain("ignoreDevUnusedFiles");
	expect(build).toContain("src 仍是唯一业务源码");
});

test("native mini program build guards runtime page boundaries", async () => {
	const build = await Bun.file(
		join(import.meta.dir, "..", "scripts", "build.ts"),
	).text();

	// 真机运行时最容易把“源码能编译”误认为“页面能正常工作”。构建脚本必须
	// 同时检查 WXML 方法、已注册跳转和本地资源，避免 404 或 WXSS 图片错误
	// 只能在开发者工具点击后才暴露。
	expect(build).toContain("validatePageRuntimeBoundaries");
	expect(build).toContain("bindingPattern");
	expect(build).toContain("pageNavigationPattern");
	expect(build).toContain("localAssetPattern");
	expect(build).toContain("cannot load local assets with background-image");
	expect(build).toContain("navigates to unregistered mini-program page");
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
	expect(home).toContain('url: "/pages/hospital-list/hospital-list"');
	expect(home).toContain(
		'url: "/pages/appointment-records/appointment-records"',
	);
	expect(home).not.toContain("预约下单功能仍在迁移中");
	expect(directory).toContain("loadAppointmentDepartments");
	expect(directory).toContain("loadDepartmentSchedules");
	expect(directory).toContain("scheduleGuard");
	expect(directory).toContain("directoryGuard");
	expect(directory).toContain("旧科室的排班覆盖当前选择");
	// 目录刷新失败时不能继续展示上一轮科室和号源；请求守卫只阻止旧响应，
	// 页面状态仍必须在新请求开始时主动清空。
	const loadDirectoryStart = directory.indexOf(
		"loadDirectory(): Promise<void>",
	);
	const loadDirectoryEnd = directory.indexOf("\n\t},", loadDirectoryStart);
	const loadDirectoryBody = directory.slice(
		loadDirectoryStart,
		loadDirectoryEnd,
	);
	expect(loadDirectoryBody).toContain("departments: []");
	expect(loadDirectoryBody).toContain("schedules: []");
	expect(loadDirectoryBody).toContain('selectedDepartmentId: ""');
	expect(records).toContain("loadAppointmentRecords");
	expect(recordsTemplate).toContain('wx:key="viewKey"');
	expect(records).toContain("resolveStoredPatientSelection");
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

test("native mini program preserves the legacy static hospital entry boundary", async () => {
	const app = await source("app.json");
	const home = await source("pages/index/index.ts");
	const page = await source("pages/hospital-list/hospital-list.ts");
	const template = await source("pages/hospital-list/hospital-list.wxml");
	const style = await source("pages/hospital-list/hospital-list.wxss");
	const build = await Bun.file(join(import.meta.dir, "build.ts")).text();
	const asset = Bun.file(
		join(sourceRoot, "assets", "hospital-list", "gaoping-hospital.jpg"),
	);

	expect(app).toContain('"pages/hospital-list/hospital-list"');
	expect(home).toContain('url: "/pages/hospital-list/hospital-list"');
	// 旧首页顶部“互联网医院”实际指向 pagesB/hospital/hospitalList，
	// 不能因为标签名称而误判为必须恢复外部 web-view。
	expect(home).toContain('action: "hospital-list"');
	expect(home).toContain('case "hospital-list"');
	expect(page).toContain("STATIC_HOSPITAL");
	expect(page).toContain(
		'url: "/pages/appointment-directory/appointment-directory"',
	);
	expect(page).toContain("/assets/hospital-list/gaoping-hospital.jpg");
	expect(page).toContain("路线服务暂未开放");
	expect(page).not.toContain("openLocation");
	expect(template).toContain("请确认就诊院区，选择对应的院区就诊！");
	expect(template).toContain('catchtap="onRouteTap"');
	expect(template).toContain('src="{{hospital.image}}"');
	expect(style).toContain("height: 380rpx");
	expect(build).toContain("hospital-list/hospital-list.js");
	expect(await asset.exists()).toBe(true);
});

test("native mini program migrates the legacy static official-account explanation", async () => {
	const app = await source("app.json");
	const home = await source("pages/index/index.ts");
	const page = await source("pages/official-account/official-account.ts");
	const template = await source("pages/official-account/official-account.wxml");
	const style = await source("pages/official-account/official-account.wxss");
	const build = await Bun.file(join(import.meta.dir, "build.ts")).text();
	const asset = Bun.file(
		join(sourceRoot, "assets", "official-account", "notice.svg"),
	);

	expect(app).toContain('"pages/official-account/official-account"');
	expect(home).toContain('action: "follow"');
	expect(home).toContain('url: "/pages/official-account/official-account"');
	expect(page).toContain("静态展示");
	expect(page).not.toContain("request");
	expect(template).toContain("欢迎关注");
	expect(template).toContain("高平医院公众号");
	expect(template).toContain("医院就诊通知");
	expect(template).toContain("/assets/official-account/notice.svg");
	expect(style).toContain("height: 200rpx");
	expect(style).toContain("padding-top: 113rpx");
	expect(build).toContain("official-account/official-account.js");
	expect(await asset.exists()).toBe(true);
});

test("native mini program exposes feedback as a safe static help page", async () => {
	const app = await source("app.json");
	const my = await source("pages/my/my.ts");
	const page = await source("pages/feedback/feedback.ts");
	const template = await source("pages/feedback/feedback.wxml");
	const style = await source("pages/feedback/feedback.wxss");
	const build = await Bun.file(join(import.meta.dir, "build.ts")).text();

	expect(app).toContain('"pages/feedback/feedback"');
	expect(my).toContain('case "feedback"');
	expect(my).toContain('url: "/pages/feedback/feedback"');
	expect(page).toContain("在线意见反馈功能正在迁移中");
	expect(page).toContain("wx.makePhoneCall");
	expect(page).toContain("SERVICE_PHONE");
	expect(template).toContain("热点问题");
	expect(template).toContain("onIssueTap");
	expect(template).toContain("意见反馈");
	expect(style).toContain("background: #f7f7f7");
	expect(build).toContain("feedback/feedback.js");
	// 不得把旧端的任意 provider URL 或反馈万能接口带入原生页。
	expect(page).not.toContain("http");
	expect(page).not.toContain("providerPatientId");
});

test("native mini program does not turn legacy static or fake settings into business success", async () => {
	const feedback = await source("pages/feedback/feedback.ts");
	const officialAccount = await source(
		"pages/official-account/official-account.ts",
	);
	const app = await source("app.json");

	// 旧反馈页没有真实提交接口，旧订阅页也只有内存开关；迁移时必须保留事实边界，
	// 不能把 Toast、打开静态说明页或本地状态当成工单/微信授权成功。
	expect(feedback).toContain("在线意见反馈功能正在迁移中");
	expect(feedback).not.toContain("提交成功");
	expect(feedback).not.toContain("设置已保存");
	expect(officialAccount).toContain("只维护静态展示");
	expect(officialAccount).not.toContain("requestSubscribeMessage");
	expect(app).not.toContain("subscription-message");
});

test("native mini program derives missed appointments from the normalized record status", async () => {
	const app = await source("app.json");
	const my = await source("pages/my/my.ts");
	const myTemplate = await source("pages/my/my.wxml");
	const page = await source("pages/missed-appointments/missed-appointments.ts");
	const template = await source(
		"pages/missed-appointments/missed-appointments.wxml",
	);
	const style = await source(
		"pages/missed-appointments/missed-appointments.wxss",
	);

	expect(app).toContain('"pages/missed-appointments/missed-appointments"');
	expect(my).toContain('case "missed-appointments"');
	expect(my).toContain('url: "/pages/missed-appointments/missed-appointments"');
	expect(myTemplate).toContain('data-action="missed-appointments"');
	expect(page).toContain("loadAppointmentRecords");
	expect(page).toContain('record.status === "missed"');
	expect(template).toContain('wx:key="viewKey"');
	expect(page).toContain("getPageLatestRequestGuard");
	expect(page).toContain("中国标准时间过去 90 天");
	expect(page).not.toContain("status === 4");
	expect(page).not.toContain("providerPatientId");
	expect(page).not.toContain("thirdPatientId");
	expect(template).toContain("暂无爽约记录");
	expect(template).toContain("展示当前就诊人过去 90 天的爽约记录");
	expect(template).toContain("查询范围为过去 90 天");
	expect(template).toContain("更换就诊人");
	expect(template).toContain("状态未知或服务异常时不会推断为爽约");
	expect(template.indexOf('class="error-message"')).toBeGreaterThanOrEqual(0);
	expect(template.indexOf('class="error-message"')).toBeLessThan(
		template.indexOf('class="trust-notice"'),
	);
	expect(style).toContain(
		'@import "../appointment-records/appointment-records.wxss"',
	);
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
	// tab 切换必须把用户本次点击的状态作为查询快照传入，不能依赖 setData 的异步回写。
	expect(outpatient).toContain(
		"loadRecords(this.data.selectedPatient, status, requestToken)",
	);
	expect(outpatient).toContain(
		"loadOutpatientPaymentRecords(patient.id, status)",
	);
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
	expect(reportPage).toContain("resolveStoredPatientSelection");
	expect(reportTemplate).toContain("报告查询");
	expect(reportTemplate).toContain("加载更多报告");
	// 报告详情只接受服务端生成的 opaque reportId，目录不透传 provider 报告号。
	expect(reportPage).not.toContain("providerReportId");
});

test("native homepage sends both add and change patient actions to the selection page", async () => {
	const home = await source("pages/index/index.ts");
	const start = home.indexOf("onHeroAction() {");
	const end = home.indexOf("openPatientSelector():", start);
	const heroAction = home.slice(start, end);

	expect(heroAction).toContain("if (!hasPlatformSession())");
	expect(heroAction).toContain(
		"afterSuccess: () => this.openPatientSelector()",
	);
	expect(heroAction).toContain("skipPatientBootstrap: true");
	expect(heroAction).toContain("this.openPatientSelector();");
	expect(heroAction).not.toContain("this.onSyncPatients();");

	const loginStart = home.indexOf("onLogin(options: LoginOptions = {})");
	const loginEnd = home.indexOf("/** 顶部就诊人卡片", loginStart);
	const login = home.slice(loginStart, loginEnd);
	expect(login).toContain(
		"if (options.skipPatientBootstrap) return Promise.resolve();",
	);
	expect(login).toContain("options.afterSuccess?.()");
});

test("native patient center does not mislabel reports as outpatient medical records", async () => {
	const home = await source("pages/index/index.ts");
	const myTemplate = await source("pages/my/my.wxml");
	const myPage = await source("pages/my/my.ts");

	expect(home).toContain('action: "medical-record"');
	expect(home).toContain("门诊病历正在迁移中");
	expect(myTemplate).toContain('data-action="medical-record"');
	expect(myTemplate).not.toContain('data-action="reports"');
	expect(myPage).toContain('case "medical-record"');
});

test("native homepage and my page reject stale patient directory responses", async () => {
	const home = await source("pages/index/index.ts");
	const my = await source("pages/my/my.ts");

	expect(home).toContain("patientDataGuard");
	expect(home).toContain("healthGuard");
	expect(home).toContain("syncLoadingGuard");
	expect(home).toContain("patientDataGuard.isCurrent(requestToken)");
	expect(home).toContain("onSyncPatients");
	expect(my).toContain("pageLoadGuard");
	expect(my).toContain("pageLoadGuard.isCurrent(requestToken)");
});

test("native homepage reloads the owner directory after returning from patient selection", async () => {
	const home = await source("pages/index/index.ts");

	// 选择页同步后可能让旧患者失效，但本地缓存中的旧 ID 仍会保留到
	// 用户显式重选；首页不能用“ID 没变化”误判为仍可展示旧患者。
	expect(home).toContain("hasShown: false");
	expect(home).toContain("if (!this.data.hasShown)");
	expect(home).toContain("if (!hasPlatformSession())");
	expect(home).toContain("clearSelectedPatientId();");
	expect(home).toContain("this.loadPatients().catch((error) =>");
	expect(home).not.toContain(
		"selectedPatientId === this.data.selectedPatientId",
	);
});

test("native appointment history pages clear old patient data before reload", async () => {
	for (const file of [
		"pages/appointment-records/appointment-records.ts",
		"pages/missed-appointments/missed-appointments.ts",
	] as const) {
		const page = await source(file);
		const loadStart = page.indexOf("loadRecords(): Promise<void>");
		const loadEnd = page.indexOf("\n\t},", loadStart);
		const loadBody = page.slice(loadStart, loadEnd);

		// 最新请求守卫只能阻止旧响应回写，不能消除请求等待期间已经展示的旧数据；
		// 记录页必须在发起新患者读取时先清理身份和列表。
		expect(loadBody).toContain("selectedPatient: null");
		expect(loadBody).toContain("records: []");
	}
});

test("native homepage fails closed when session recovery cannot be completed", async () => {
	const home = await source("pages/index/index.ts");

	// 401 清除 token 后，微信登录又遇到 503 时，旧页面实例不能继续展示
	// 上一位患者；依赖暂时不可用但 token 尚存时则不能误删可重试会话。
	expect(home).toContain(
		"if (!hasPlatformSession()) this.clearPatientContext();",
	);
	expect(home).toContain("clearPatientContext(): void");
	expect(home).toContain("auth/wechat");
});

test("native my page clears stale patient context when owner reads fail", async () => {
	const my = await source("pages/my/my.ts");

	// 依赖暂时不可用时不能继续展示上一轮患者卡片；同时不删除本地选择，
	// 让下一次成功的 owner-scoped 目录读取仍有机会恢复用户的显式选择。
	expect(my).toContain('userLabel: "微信用户"');
	expect(my).toContain("selectedPatient: null");
	expect(my).toContain("patientCount: 0");
	expect(my).toContain("不删除本地 selectedPatientId");
	expect(my).toContain("safeApiErrorMessage(error, fallback)");
});

test("patient context pull-to-refresh waits for the complete directory lifecycle", async () => {
	const home = await source("pages/index/index.ts");
	const selection = await source("pages/patient-select/patient-select.ts");

	// 刷新指示器必须覆盖健康检查、目录读取和临床映射同步，不能只等待第一段请求。
	expect(home).toContain(
		"return Promise.all([this.checkHealth(), patientRefresh])",
	);
	expect(home).toContain(
		"this.onRefresh().finally(() => wx.stopPullDownRefresh())",
	);
	expect(selection).toContain("return this.onSyncPatients();");
	expect(selection).toContain(
		"this.loadPatientList().finally(() => wx.stopPullDownRefresh())",
	);
	const syncCallIndex = selection.indexOf("return this.onSyncPatients();");
	const loadPatientListBody = selection.slice(
		selection.indexOf("loadPatientList(): Promise<void>"),
		syncCallIndex,
	);
	// 目录读取完成不等于临床映射同步完成；同步期间必须继续阻止页面进入业务。
	expect(loadPatientListBody).not.toContain(
		"this.setData({ loading: false });",
	);
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
	expect(service).toContain("appointmentRecordsPast: 90");
	expect(service).toContain("appointmentRecordsFuture: 90");
	expect(service).toContain('window: "history" | "missed"');
	expect(service).toContain("reports: 30");
	expect(service).toContain("requirePatientId");
	expect(service).not.toContain("providerPatientId");
	expect(service).not.toContain("msun-middle-business");
});

test("dashboard service calculates China Standard Time calendar windows", () => {
	// 这是中国标准时间 2026-08-15 23:59:59；不依赖测试机的本地时区。
	const now = new Date("2026-08-15T15:59:59.000Z");

	expect(formatPlatformDate(now)).toBe("2026-08-15");
	expect(createPastDateRange(90, now)).toEqual({
		startDate: "2026-05-17",
		endDate: "2026-08-15",
	});
	expect(createAppointmentRecordDateRange(now)).toEqual({
		startDate: "2026-05-17",
		endDate: "2026-11-13",
	});
	expect(createUpcomingDateRange(7, now)).toEqual({
		startDate: "2026-08-15",
		endDate: "2026-08-22",
	});

	// 到达中国标准时间零点后必须切换自然日，验证不能按设备本地日期读取。
	const afterChinaMidnight = new Date("2026-08-15T16:00:00.000Z");
	expect(formatPlatformDate(afterChinaMidnight)).toBe("2026-08-16");
});

test("appointment directory labels provider calendar dates without device timezone drift", async () => {
	const page = await source(
		"pages/appointment-directory/appointment-directory.ts",
	);

	// workDate 是医院日历值，页面不能用设备本地 getMonth/getDate/getDay 推导星期。
	expect(page).toContain("T00:00:00.000Z");
	expect(page).toContain("getUTCMonth()");
	expect(page).toContain("getUTCDate()");
	expect(page).toContain("getUTCDay()");
	expect(page).not.toContain("getMonth()");
	expect(page).not.toContain("getDate()");
	expect(page).not.toContain("getDay()");
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
	const missedAppointments = await source(
		"pages/missed-appointments/missed-appointments.ts",
	);
	const home = await source("pages/index/index.ts");
	const my = await source("pages/my/my.ts");

	for (const page of [
		records,
		reports,
		payments,
		selection,
		appointmentDirectory,
		missedAppointments,
		home,
		my,
	]) {
		expect(page).toContain("getPageLatestRequestGuard");
		expect(page).toContain("isCurrent");
		// 页面文件不能直接在模块顶层创建共享 guard；实例状态必须由
		// page-instance-state 的 WeakMap 按当前 this 隔离。
		expect(page).not.toContain("createLatestRequestGuard()");
		expect(page).not.toContain("createSingleFlight<");
	}
});

test("every registered native page keeps async state instance-scoped", async () => {
	const app = JSON.parse(await source("app.json")) as {
		pages: string[];
	};

	for (const pagePath of app.pages) {
		const page = await source(`${pagePath}.ts`);
		// app.json 是微信运行时的页面事实源；按注册表反向扫描，避免新页面
		// 绕过人工维护的固定数组，把 guard 或单飞对象重新放回模块顶层。
		expect(page).not.toContain("createLatestRequestGuard(");
		expect(page).not.toContain("createSingleFlight<");
		if (page.includes("isCurrent(")) {
			expect(page).toContain("getPageLatestRequestGuard");
		}
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
