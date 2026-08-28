import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	ApiError,
	buildApiRequestUrl,
	CLIENT_ERROR_MESSAGES,
	createIdempotencyKey,
	isAllowedApiBaseUrl,
	isAllowedApiPrefix,
	localizedApiErrorMessage,
	normalizeApiBaseUrl,
	safeApiErrorMessage,
	toWechatPaymentParams,
} from "../src/services/api-client";
import { formatAppointmentDateLabel } from "../src/services/appointment-directory-view";
import {
	createAppointmentRecordDateRange,
	createPastDateRange,
	createUpcomingDateRange,
	formatPlatformDate,
} from "../src/services/dashboard-service";
import { createLatestRequestGuard } from "../src/services/latest-request-guard";
import { resolvePatientSelection } from "../src/services/patient-selection-service";
import {
	LABORATORY_FLAG_LABELS,
	toLaboratoryReportItemView,
} from "../src/services/report-presenter";
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
	expect(client).toContain("requireAuthSessionResponse");
	expect(client).toContain("apiPrefix");
	expect(app).toContain('apiBaseUrl: "https://test-hp.meiyi.pro"');
	expect(app).toContain('apiPrefix: "/api/v2"');
	expect(client).not.toContain("/sns/jscode2session");
	expect(client).not.toContain("api.weixin.qq.com");
});

test("native DevTools project isolates dist runtime from TypeScript source", async () => {
	const projectConfig = JSON.parse(
		await Bun.file(join(import.meta.dir, "..", "project.config.json")).text(),
	) as {
		miniprogramRoot?: string;
		packOptions?: {
			ignore?: Array<{ type?: string; value?: string }>;
		};
	};

	// `src/` 和 `dist/` 同时处于小程序项目根目录时，开发者工具可能监听
	// 两层文件并把源配置重新带入运行图。运行入口必须固定在 dist/，同时
	// 忽略源码和构建脚本，才能保证共享 TabBar 与页面脚本来自同一份候选。
	expect(projectConfig.miniprogramRoot).toBe("dist/");
	expect(projectConfig.packOptions?.ignore).toContainEqual({
		type: "folder",
		value: "src",
	});
	expect(projectConfig.packOptions?.ignore).toContainEqual({
		type: "folder",
		value: "scripts",
	});

	const runtimeProjectConfig = JSON.parse(
		await Bun.file(
			join(import.meta.dir, "..", "dist", "project.config.json"),
		).text(),
	) as {
		miniprogramRoot?: string;
		setting?: {
			compileHotReLoad?: boolean;
			ignoreDevUnusedFiles?: boolean;
		};
	};
	// 父目录配置只负责构建约束；开发者工具和真机必须直接打开 dist，
	// 这样工具的 watcher 根不会再覆盖旁边的 TypeScript 源码目录。
	expect(runtimeProjectConfig.miniprogramRoot).toBe("./");
	expect(runtimeProjectConfig.setting?.compileHotReLoad).toBe(false);
	expect(runtimeProjectConfig.setting?.ignoreDevUnusedFiles).toBe(false);
});

test("native App entry does not trust a cached token before session verification", async () => {
	const app = await source("app.ts");

	// 本地缓存只是一项待验证输入；如果 App 入口先把它写入全局并标记已登录，
	// 首页可能在 `/me` 返回前展示旧患者，或者让损坏缓存绕过统一会话边界。
	// 会话服务负责读取、校验并在服务端证明后写入全局状态。
	expect(app).not.toContain('wx.getStorageSync("access_token")');
	expect(app).not.toContain("this.globalData.accessToken = storedToken");
	expect(app).not.toContain('this.globalData.sessionStatus = "signed_in"');
	// App.onLaunch 必须显式传递稳定的启动容器；不能把 this 或 getApp()
	// 在启动窗口内已经可用当成前提。
	expect(app).toContain("ensureGlobalUserProfile(APP_CONTAINER)");
	expect(app).toContain("registerBootstrapApp(APP_CONTAINER)");
	expect(app).toContain("startGlobalUserProfileBootstrap");
	expect(app).toContain("catch (error: unknown)");
	expect(app).toContain("onLaunch()");
});

test("native login keeps WeChat profile consent separate from session exchange", async () => {
	const client = await source("services/api-client.ts");
	const consent = await source("services/wechat-user-profile.ts");

	// `wx.login` 的 code 交换本身不会弹出头像/昵称授权；个人资料只能由
	// 用户手势触发独立的授权服务，不能混入登录或患者初始化请求。
	expect(client).toContain("wx.login");
	expect(client).not.toMatch(/\bwx\.getUserProfile\s*\(/u);
	expect(client).not.toMatch(/\bwx\.getUserInfo\s*\(/u);
	expect(consent).toContain("wx.getUserProfile");
	expect(consent).toContain("用于完善个人中心的头像、昵称和性别");
	expect(consent).toContain("requestWechatUserProfile");
});

test("native user profile is bootstrapped once and shared across primary tabs", async () => {
	const globalProfile = await source("services/global-user-profile.ts");
	const home = await source("pages/index/index.ts");
	const my = await source("pages/my/my.ts");
	const profile = await source("pages/profile/profile.ts");
	const app = await source("app.ts");

	// App.onLaunch 是唯一自动初始化入口；首页、“我的”和资料编辑页只等待
	// 这份全局快照，避免每次切换 Tab 都重新请求 `/me/profile` 或重置旧资料。
	expect(app).toContain("ensureGlobalUserProfile(APP_CONTAINER)");
	expect(app).toContain("registerBootstrapApp(APP_CONTAINER)");
	expect(home).toContain("waitForGlobalUserProfile()");
	expect(home).not.toContain("ensureGlobalUserProfile()");
	expect(globalProfile).toContain("profileBootstrapInFlight");
	expect(globalProfile).toContain("userProfileBootstrapPromise");
	expect(globalProfile).toContain("subscribeGlobalUserProfile");
	expect(my).toContain("subscribeGlobalUserProfile");
	expect(my).toContain("waitForGlobalUserProfile()");
	expect(my).not.toContain("ensureGlobalUserProfile()");
	expect(my).not.toContain("return getUserProfile()");
	expect(profile).toContain("waitForGlobalUserProfile()");
	expect(profile).not.toContain("ensureGlobalUserProfile()");
	expect(globalProfile).toContain("userProfileConsentPromise");
	expect(globalProfile).not.toContain("profileConsentInFlight");
	expect(globalProfile).toContain("authorizeGlobalWechatProfileInternal");
});

test("native migration entries expose a typed blocking reason instead of a generic toast", async () => {
	const navigation = await source("services/feature-navigation.ts");
	const statusPage = await source("pages/feature-status/feature-status.wxml");
	const home = await source("pages/index/index.ts");
	const my = await source("pages/my/my.ts");

	// 迁移期间“能点击”只是入口完整性，不代表业务已完成。所有状态页都必须
	// 把当前真正的准入阻塞类型带给用户；同时首页和“我的”里调用固定状态页的
	// key 必须存在于同一份目录，防止新增入口落入无意义 Toast 或 404。
	expect(navigation).toContain('"待 provider contract"');
	expect(navigation).toContain('"待临床审核"');
	expect(navigation).toContain('"待支付与回写 contract"');
	expect(navigation).toContain('"待患者绑定 contract"');
	expect(navigation).toContain('"待外部入口 contract"');
	expect(statusPage).toContain("{{feature.readiness}}");
	expect(statusPage).toContain("{{coverage.contractFamilyLabel}}");
	expect(statusPage).toContain("{{coverage.notes}}");
	expect(statusPage).not.toContain("功能迁移中</view>");

	for (const page of [home, my]) {
		for (const match of page.matchAll(
			/navigateToFeatureStatus\("([^"]+)"\)/gu,
		)) {
			const featureKey = match[1];
			if (!featureKey) continue;
			// 目录中的合法 TypeScript 对象键可能是 companion:，也可能是
			// "patient-binding":；两种写法都必须仍然落在同一份目录中。
			expect(
				navigation.includes(`"${featureKey}"`) ||
					navigation.includes(`${featureKey}:`),
			).toBe(true);
		}
	}
});

test("native homepage and my-page actions all have explicit dispatch branches", async () => {
	const home = await source("pages/index/index.ts");
	const my = await source("pages/my/my.ts");

	// 配置数组和事件分发是两份容易漂移的事实：只新增图标/action 而忘记
	// switch 分支时，页面仍然能渲染，但点击会落入默认 Toast。这里逐项检查
	// 首页快捷入口、服务栅格和“我的”菜单，保证每个可见 action 都有明确
	// 的业务页面或 FeatureKey 状态页落点。
	for (const page of [home, my]) {
		const actions = new Set(
			[...page.matchAll(/action: "([^"]+)"/gu)].map((match) => match[1]),
		);
		for (const action of actions) {
			if (!action) continue;
			expect(page).toContain(`case "${action}"`);
		}
	}
});

test("consult tab keeps the old three-tab shell while realtime remains closed", async () => {
	const page = await source("pages/consult/consult.ts");
	const template = await source("pages/consult/consult.wxml");
	const style = await source("pages/consult/consult.wxss");

	// 先迁移患者栏、三个标签和稳定状态容器，避免实时 contract 未到时整页无入口；
	// 旧 WebSocket/队列字段不能因为页面复刻而偷偷重新接入。
	expect(page).toContain('id: "today"');
	expect(page).toContain('id: "upcoming"');
	expect(page).toContain('id: "history"');
	expect(page).toContain("navigateToPatientSelector");
	expect(page).not.toContain("connectWebSocket");
	expect(page).not.toContain("getQueuePositionApi");
	expect(template).toContain('bindtap="onChangePatient"');
	expect(template).toContain('bindtap="onTabTap"');
	expect(template).toContain("query-state-shell");
	expect(style).toContain(".consult-patient-card");
	expect(style).toContain(".consult-tab-active");
});

test("native profile consent remains clickable while patient data is loading", async () => {
	const my = await source("pages/my/my.ts");
	const template = await source("pages/my/my.wxml");
	const style = await source("pages/my/my.wxss");

	// 患者目录和微信资料授权是两条独立的用户动作；目录 loading 不能吞掉
	// 用户对“未授权”提示的点击，否则真机会表现为提示闪动但没有授权弹窗。
	expect(my).toContain('if (this.data.wechatProfileState === "loading")');
	expect(my).not.toContain(
		'this.data.loading || this.data.wechatProfileState === "loading"',
	);
	expect(template).toContain(
		'class="profile-auth-action" catchtap="onWechatProfileTap"',
	);
	expect(my).toContain("openWechatUserProfileSettings");
	expect(my).toContain('this.data.wechatProfileState === "declined"');
	expect(await source("services/wechat-user-profile.ts")).toContain(
		"拒绝后再次直接调用",
	);
	expect(style).toContain("扩大授权提示的可点击区域");
});

test("native profile consent remains available when ordinary profile read is temporarily unavailable", async () => {
	const my = await source("pages/my/my.ts");
	const globalProfile = await source("services/global-user-profile.ts");

	// `/me` 已确认当前 owner 时，普通资料接口的暂时异常不能把微信资料
	// 授权入口误判成未登录；用户明确点击后仍应进入独立授权流程。
	expect(my).toContain(
		'(globalProfile.status !== "ready" && globalProfile.status !== "error")',
	);
	expect(globalProfile).toContain("function canAuthorizeWechatProfile");
	expect(globalProfile).toContain("普通资料接口暂时失败不等于微信会话失效");
	expect(globalProfile).toContain('status: "ready"');
});

test("native client restores a platform session through the current-user endpoint", async () => {
	const client = await source("services/api-client.ts");
	const page = await source("pages/index/index.ts");

	expect(client).toContain("getCurrentUser");
	expect(client).toContain('url: "/me"');
	expect(client).toContain("requireCurrentUserResponse");
	expect(page).toContain("验证会话中");
	expect(client).not.toContain("providerSubject");
});

test("native patient, appointment and outpatient reads validate the platform envelope before rendering", async () => {
	const client = await source("services/api-client.ts");
	const dashboard = await source("services/dashboard-service.ts");

	// 业务 validator 只负责各自读模型；所有列表先经过 success/data 包络门禁，
	// 防止错误 JSON 被当成空目录或继续流入金额、预约状态渲染。
	expect(client).toContain("requireSuccessDataResponse");
	expect(client).toContain('url: "/appointments/departments"');
	expect(client).toContain('url: "/patients/sync"');
	expect(client).toContain('OutpatientPaymentListResponse["data"]');
	expect(dashboard).toContain("requireSuccessDataResponse");
	expect(dashboard).toContain("const seenRecordIds = new Set<string>()");
	expect(dashboard).toContain("isOutpatientBillDateTime");
});

test("native patient selectors do not report a selection error during loading", async () => {
	// 预约记录和门诊费用都会先清空旧患者，再依次完成 `/me`、患者目录
	// 和业务列表读取。页面的 null 只表示“本轮事实尚未提交”，不能在
	// loading 期间被渲染成“请先选择就诊人”，否则用户会把等待误判为失败。
	for (const pagePath of [
		"pages/appointment-records/appointment-records.wxml",
		"pages/outpatient-payment/outpatient-payment.wxml",
	]) {
		const page = await source(pagePath);
		expect(page).toContain(
			'<text wx:elif="{{loading}}" class="selector-name">正在加载就诊人...</text>',
		);
		expect(page).toContain(
			'<text wx:elif="{{canSelectPatient}}" class="selector-name">请先选择就诊人</text>',
		);
		expect(page).toContain("当前就诊人信息暂不可用");
	}
});

test("native patient-scoped list errors do not fall through to empty patient state", async () => {
	// 服务端错误已经在页面顶部展示，但 WXML 仍必须维持错误、空结果和
	// 加载中的业务边界；共享状态外壳只替换内部文案，不能把 Provider 失败
	// 渲染成“请先选择就诊人/暂无数据”。
	const pages = [
		[
			"pages/appointment-records/appointment-records.wxml",
			"pages/appointment-records/appointment-records.ts",
		],
		[
			"pages/outpatient-payment/outpatient-payment.wxml",
			"pages/outpatient-payment/outpatient-payment.ts",
		],
		[
			"pages/report-directory/report-directory.wxml",
			"pages/report-directory/report-directory.ts",
		],
		[
			"pages/missed-appointments/missed-appointments.wxml",
			"pages/missed-appointments/missed-appointments.ts",
		],
	] as const;

	for (const [templatePath, pagePath] of pages) {
		const [template, page] = await Promise.all([
			source(templatePath),
			source(pagePath),
		]);
		expect(template).toContain(
			'class="state-card query-state-shell query-state-shell-column',
		);
		expect(template).toContain('<block wx:elif="{{error}}">');
		expect(template).toContain("query-state-shell");
		expect(template).toContain('bindtap="onRetry"');
		if (templatePath.includes("missed-appointments")) {
			// 爽约页缺少患者上下文时只保留本页错误态，不能自动打开患者
			// 选择模块；入口门禁和爽约查询的语义必须保持分离。
			expect(template).not.toContain("请先选择就诊人");
			expect(template).not.toContain("点击这里选择就诊人");
			expect(page).not.toContain("redirectToPatientSelector");
		} else {
			expect(template).toContain('bindtap="onChangePatient"');
		}
		expect(page).toContain("onRetry(): void");
	}
});

test("patient selection errors do not fall through to an unbound-patient empty state", async () => {
	const selection = await source("pages/patient-select/patient-select.ts");
	const template = await source("pages/patient-select/patient-select.wxml");

	// 目录同步失败可能是会话失效、网络故障或临床映射依赖不可用；这些事实
	// 不能被渲染成“当前账号暂无就诊人”，否则用户会误以为需要重新绑定患者。
	const errorBranch = '<block wx:elif="{{error}}">';
	expect(template.indexOf(errorBranch)).toBeGreaterThan(-1);
	expect(template.indexOf(errorBranch)).toBeLessThan(
		template.indexOf(
			'<view wx:elif="{{patients.length}}" class="patient-list">',
		),
	);
	expect(template).toContain('bindtap="onRetry"');
	expect(selection).toContain("onRetry(): void");
	expect(selection).toContain("void this.loadPatientList()");
});

test("appointment directory errors do not fall through to cascade or empty schedule state", async () => {
	const directory = await source(
		"pages/appointment-directory/appointment-directory.ts",
	);
	const template = await source(
		"pages/appointment-directory/appointment-directory.wxml",
	);

	// 科室读取和排班读取都属于同一只读目录链；任一层失败时统一回到完整
	// 目录重试，不能把旧快照或空数组解释成“没有可预约内容”。
	const errorBranch = '<block wx:elif="{{error}}">';
	expect(template.indexOf(errorBranch)).toBeGreaterThan(-1);
	expect(template.indexOf(errorBranch)).toBeLessThan(
		template.indexOf(
			'<view wx:elif="{{departments.length}}" class="cascade-shell">',
		),
	);
	expect(template).toContain('bindtap="onRetry"');
	// 首层目录和右栏排班都必须固定状态高度，避免加载完成切到图片空态时跳动。
	expect(template).toContain(
		'class="state-card query-state-shell query-state-shell-column"',
	);
	expect(template).toContain(
		'class="panel-loading query-state-shell query-state-shell-column"',
	);
	expect(template).toContain(
		'class="panel-empty query-state-shell query-state-shell-column"',
	);
	expect(directory).toContain("onRetry(): void");
	expect(directory).toContain("void this.loadDirectory()");
});

test("native client single-flights login and preserves a newer concurrent token", async () => {
	const client = await source("services/api-client.ts");

	// 首页恢复、患者同步和业务页面可能同时触发会话请求；一次性 wx.login code
	// 只能由一个请求消费，旧 401 也不能清理并发请求刚换得的新 token。
	expect(client).toContain("loginInFlight");
	expect(client).toContain("const promise = performLogin()");
	expect(client).toContain("currentToken !== accessToken");
	expect(client).toContain("return requestAfterSessionRecovery(");
	expect(client).toContain("config.accessToken !== accessToken");
	expect(client).toContain(
		'appData.sessionStatus = accessToken ? "signed_in" : "signed_out"',
	);
});

test("native authenticated reads reject responses from an older session generation", async () => {
	const client = await source("services/api-client.ts");
	const generation = await source("services/session-generation.ts");

	// 页面守卫只能保护当前页面实例；服务层必须在响应交付前再检查会话代际，
	// 才能覆盖跨页面、跨页面栈的账号切换。
	expect(client).toContain("requestForSession");
	expect(client).toContain("isCurrentSessionGeneration(sessionGeneration)");
	expect(client).toContain('code: "session-changed"');
	expect(generation).toContain("isCurrentSessionGeneration");
});

test("native client sends request ids for Pino HTTP correlation", async () => {
	const client = await source("services/api-client.ts");

	expect(client).toContain('"x-request-id": requestId');
	expect(client).toContain("responseRequestId(response)");
	expect(client).not.toContain('"authorization": requestId');
});

test("native client localizes every public query and session error boundary", () => {
	expect(localizedApiErrorMessage("patient-query-invalid", "fallback")).toBe(
		"就诊人查询条件不合法",
	);
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
	expect(
		localizedApiErrorMessage(
			"provider-response-invalid",
			"英文 provider 响应文案",
		),
	).toBe("外部服务返回数据异常，请稍后重试");
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
	const dashboard = await source("services/dashboard-service.ts");
	const page = await source("pages/index/index.ts");

	expect(client).toContain("syncPatients");
	expect(client).toContain('url: "/patients/sync"');
	expect(dashboard).toContain("runPatientSync");
	expect(dashboard).toContain("createIdempotencyKey(operationPrefix)");
	// 读取和同步都必须经过同一个列表总数门禁；否则异常同步快照会绕过
	// 患者目录读取边界，继续进入页面协调器并被当作成功结果消费。
	expect(
		(dashboard.match(/requirePatientListData\(payload\.data\)\.items/g) ?? [])
			.length,
	).toBe(2);
	expect(page).toContain("onSyncPatients");
	expect(page).toContain('syncPatientsFromHospital("patient-sync")');
	expect(page).not.toContain("unionId");
	expect(page).not.toContain("providerPatientId");
});

test("native patient QR entry requires a confirmed patient snapshot", async () => {
	const page = await source("pages/index/index.ts");
	const qrStart = page.indexOf("onPatientQr() {");
	const qrEnd = page.indexOf("\n\t},", qrStart);
	const qrBody = page.slice(qrStart, qrEnd);

	// 本地缓存的 opaque patientId 可能在会话失效或目录读取失败后仍保留，
	// 不能把它当作当前患者事实，更不能据此开放或暗示二维码能力。二维码
	// 入口必须同时校验当前临床映射和 storage 的显式选择，防止旧页面跨会话误判。
	expect(qrBody).toContain('sessionState !== "valid"');
	expect(qrBody).toContain('selectedPatient.clinicalAccess !== "ready"');
	expect(qrBody).toContain("isCurrentSelectedPatient(selectedPatient.id)");
	expect(qrBody).toContain("showPatientQr: true");
	expect(qrBody).toContain("patientQrCardNumber");
	expect(qrBody).not.toContain("api.qrserver.com");
	expect(qrBody).toContain('title: "暂无就诊人"');
	expect(qrBody).not.toContain("this.data.selectedPatientId ?");
});

test("native patient pages preserve stale semantics for an empty synchronized directory", async () => {
	const indexPage = await source("pages/index/index.ts");
	const selectionPage = await source("pages/patient-select/patient-select.ts");

	// 解析器已经区分“从未绑定”和“已有选择但目录为空”；页面同步回写
	// 只能消费这份解析结果，不能再按 patients.length 重新覆盖成 empty。
	expect(indexPage).toContain("setPatientsFromPayload(patients);");
	expect(selectionPage).toContain("this.setPatientList(patients);");
	expect(indexPage).not.toContain('code: "patient-not-bound"');
	expect(selectionPage).not.toContain('code: "patient-not-bound"');
});

test("native client generates bounded non-colliding patient sync idempotency keys", () => {
	const first = createIdempotencyKey("patient sync");
	const second = createIdempotencyKey("patient sync");

	// 幂等键只用于区分操作，不是 token；但仍必须满足服务端 header 的字符和长度约束。
	expect(first).toMatch(/^patient-sync-[a-z0-9]+-[a-z0-9]{8}$/);
	expect(first.length).toBeLessThanOrEqual(128);
	expect(second).not.toBe(first);
	expect(createIdempotencyKey("!!!")).toMatch(/^operation-/);
});

test("native mini program exposes a real patient selection page", async () => {
	const app = await source("app.json");
	const home = await source("pages/index/index.ts");
	const selection = await source("pages/patient-select/patient-select.ts");
	const template = await source("pages/patient-select/patient-select.wxml");
	const service = await source("services/patient-selection-service.ts");
	const navigation = await source("services/patient-navigation.ts");

	expect(app).toContain('"pages/patient-select/patient-select"');
	expect(home).toContain("openPatientSelector");
	// 首页只能把新增/更换动作交给独立选择页，不能保留可被误绑定的直接写入入口。
	expect(home).not.toContain("onSelectPatient");
	expect(home).not.toContain("setSelectedPatientId");
	expect(navigation).toContain('url: "/pages/patient-select/patient-select"');
	expect(home).not.toContain("wx.showActionSheet");
	expect(home).toContain("onShow()");
	expect(selection).toContain("loadPatients");
	expect(selection).toContain("hasShown: false");
	expect(selection).toContain("onShow(): void");
	expect(selection).toContain("this.clearDisplayedPatientDirectory();");
	expect(selection).toContain('switchToPrimaryTab("/pages/index/index");');
	expect(selection).toContain("onPatientTap");
	expect(selection).toContain("setSelectedPatientId");
	expect(selection).toContain("onUnload");
	expect(selection).toContain("navigationPending");
	expect(selection).toContain("if (!this.data.navigationPending) return;");
	expect(selection).toContain(
		"if (this.data.loading || this.data.syncing || this.data.navigationPending)",
	);
	expect(selection).toContain("wx.stopPullDownRefresh();");
	expect(selection).toContain("patientNavigationTimers");
	expect(selection).toContain("clearTimeout(navigationTimer)");
	expect(selection).toContain("patientNavigationTimers.delete(this)");
	expect(selection).toContain("disposePageInstance(this)");
	expect(selection).toContain(
		'syncPatientsFromHospital("patient-selection-sync")',
	);
	expect(template).toContain("patient-card-selected");
	expect(template).toContain("patient-card-unavailable");
	expect(template).toContain("暂不可查");
	// 同步失败时保留已经读取的患者卡片，但通过 selectionReady 将其全部
	// 标记为不可查询；错误不能把诊断用目录误渲染成成功空态。
	expect(template).toContain('wx:if="{{loading || !patients.length}}"');
	expect(template).toContain(
		"item.clinicalAccess !== 'ready' || !selectionReady",
	);
	expect(selection).toContain("就诊人同步未完成，请先刷新");
	expect(template).toContain("刷新就诊人");
	// WXML 事件对象不能进入只接受 number 的内部加载 token 流程；
	// 真机刷新必须经过无参数事件入口再创建本轮 token。
	expect(template).toContain('bindtap="onSyncPatients"');
	expect(template).toContain(
		'disabled="{{loading || syncing || navigationPending}}"',
	);
	expect(selection).toContain("onSyncPatients(): Promise<void>");
	expect(selection).toContain("syncPatientDirectoryForLoad(loadToken: number)");
	expect(selection).not.toContain(
		"onSyncPatients(loadToken?: number): Promise<void>",
	);
	expect(selection).toContain("hasClinicallyReadyPatients");
	expect(selection).toContain("patientSelectionResolutionMessage");
	expect(home).toContain("patientSelectionResolutionMessage");
	expect(selection).toContain('clinicalAccess !== "ready"');
	// 页面不再自行拼接临床映射错误码；统一解析器负责 empty/stale/
	// unavailable 三种患者上下文语义，页面只消费安全文案。
	expect(service).toContain('code: "patient-clinical-unavailable"');
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
		clinicalAccess: "ready",
	} satisfies Patient;
	const patientB = {
		id: "patient-b",
		displayName: "患者乙",
		relationship: "child",
		cardNumberMasked: "******0002",
		source: "hospital-his",
		clinicalAccess: "ready",
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
		state: "stale",
		storedPatientId: "patient-removed",
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

	// provider 文档和最终状态查询未冻结前，页面只能进入安全的迁移外壳，
	// 不能产生“查档失败后继续建档”的旧端副作用，也不能把医院患者号带回小程序。
	expect(selection).toContain("onAddPatient");
	expect(selection).toContain("navigateToFeatureEntry");
	expect(selection).toContain('"patient-binding"');
	expect(selection).not.toContain("getArchivesInfoApi");
	expect(selection).not.toContain("createPatientApi");
	expect(selection).not.toContain("bindCardApi");
	expect(template).toContain("添加就诊人");
	expect(template).toContain("真实绑定接口接入前进入统一状态页");
	expect(bindingContract).toContain("查找异常不得转成“没有档案”");
	expect(bindingContract).toContain("PB-01");
});

test("patient selection keeps an existing confirmed directory when provider refresh fails", async () => {
	const selection = await source("pages/patient-select/patient-select.ts");

	// 平台 GET 目录已经返回 ready 患者时，它代表上一轮已确认的临床映射；
	// Provider 本次刷新失败不能把选择页锁死。首次没有 ready 患者时仍然严格关闭。
	expect(selection).toContain("selectionReady: false");
	expect(selection).toContain("this.data.loading");
	expect(selection).toContain("this.data.syncing");
	expect(selection).toContain("hasClinicallyReadyPatients(patients)");
	expect(selection).toContain("this.setData({ selectionReady: true })");
	expect(selection).toContain("keepExistingSelection");
});

test("patient selection clears the current badge after synchronization failure", async () => {
	const selection = await source("pages/patient-select/patient-select.ts");

	// 失败时列表可以留下来供诊断和重试，但当前标记必须清除；本地 opaque
	// patientId 仍然保留在 storage，不能因为一次暂时失败而静默改选或丢失选择。
	expect(selection).toContain('selectedPatientId: ""');
	expect(selection).toContain("selectionReady: false");
	expect(selection).toContain("不删除本地");
});

test("patient selection clears the old directory after session ownership is lost", async () => {
	const selection = await source("pages/patient-select/patient-select.ts");
	const showErrorStart = selection.lastIndexOf(
		"showError(error: unknown, fallback: string): void",
	);
	const clearDirectoryIndex = selection.indexOf(
		"shouldClearPatientDirectory(error)",
		showErrorStart,
	);
	const patientListClearIndex = selection.indexOf(
		"this.clearDisplayedPatientDirectory();",
		showErrorStart,
	);

	// 暂时故障可以保留列表帮助重试，但 401、账号切换或重新登录失败后，
	// 患者姓名/关系/脱敏卡号也必须清理，不能只清除“当前”角标。
	expect(selection).toContain("shouldClearPatientDirectory");
	expect(selection).toContain('error.code === "session-changed"');
	expect(selection).toContain("if (!hasPlatformSession()) return true;");
	expect(selection).toContain("isPatientSelectionSessionCurrent");
	expect(selection).toContain("登录状态已变化，正在重新刷新");
	expect(selection).toContain(
		"patientSelectionSessionGenerations.delete(this)",
	);
	expect(clearDirectoryIndex).toBeGreaterThan(showErrorStart);
	expect(patientListClearIndex).toBeGreaterThan(clearDirectoryIndex);
	expect(selection).toContain("clearDisplayedPatientDirectory(): void");
	expect(selection).toContain('switchToPrimaryTab("/pages/index/index");');
	expect(selection).toContain("不能在当前页面自动重登并重放");
});

test("native profile returns to login after the session owner is lost", async () => {
	const profile = await source("pages/profile/profile.ts");
	const errorStart = profile.lastIndexOf(
		"showError(error: unknown, fallback: string): void",
	);
	const errorEnd = profile.indexOf("\n\t},", errorStart);
	const errorBody = profile.slice(errorStart, errorEnd);

	// 资料 GET 的自动恢复或资料 PUT 的明确失效都不能把用户留在旧页面；
	// 返回首页后由用户确认当前微信账号，避免自动重放普通资料命令。
	expect(errorBody).toContain("shouldReturnToLogin(error)");
	expect(errorBody).toContain('switchToPrimaryTab("/pages/index/index");');
	expect(errorBody).toContain("不能把用户留在旧页面");
});

test("native profile distinguishes invalid read models from session loss", async () => {
	const profile = await source("pages/profile/profile.ts");
	const clearStart = profile.indexOf("function shouldClearProfileDisplay");
	const loginStart = profile.indexOf("function shouldReturnToLogin");
	const showErrorStart = profile.lastIndexOf(
		"showError(error: unknown, fallback: string): void",
	);
	const showErrorEnd = profile.indexOf("\n\t},", showErrorStart);
	const clearBody = profile.slice(clearStart, loginStart);
	const loginBody = profile.slice(loginStart, showErrorStart);
	const showErrorBody = profile.slice(showErrorStart, showErrorEnd);

	// persistence-invalid 说明服务端无法确认资料读模型，旧资料必须清空；
	// 成功包络/字段校验失败的 provider-response-invalid 也必须清空旧资料；
	// 但它们都不是 unauthorized，不能通过 reLaunch 把数据层故障伪装成登录失效。
	expect(clearBody).toContain('error.code === "persistence-invalid"');
	expect(clearBody).toContain('error.code === "provider-response-invalid"');
	expect(loginBody).not.toContain('error.code === "persistence-invalid"');
	expect(loginBody).not.toContain('error.code === "provider-response-invalid"');
	expect(showErrorBody).toContain("shouldReturnToLogin(error)");
});

test("native profile loading errors expose an explicit canonical reload", async () => {
	const profile = await source("pages/profile/profile.ts");
	const template = await source("pages/profile/profile.wxml");
	const errorBranch = '<block wx:elif="{{error}}">';
	const formBranch =
		'<view wx:elif="{{!loading && loaded}}" class="form-card">';

	// GET 失败后没有可信的 version 和会话代际；页面必须提供重新读取入口，
	// 不能把错误直接落入可编辑表单，也不能要求用户只能使用下拉刷新。
	// 保存阶段的暂时失败仍保留 loaded=true，因此 error 本身不能成为隐藏表单的条件。
	expect(template).toContain('wx:if="{{loading || !loaded}}"');
	expect(template).toContain(
		'class="state-card query-state-shell query-state-shell-column"',
	);
	expect(template.indexOf(errorBranch)).toBeGreaterThan(
		template.indexOf('wx:if="{{loading || !loaded}}"'),
	);
	expect(template.indexOf(errorBranch)).toBeLessThan(
		template.indexOf(formBranch),
	);
	expect(template).toContain('bindtap="onRetry"');
	expect(profile).toContain("onRetry(): void");
	expect(profile).toContain("void this.loadProfile(true)");
});

test("homepage and my page expose explicit retry actions for top errors", async () => {
	const home = await source("pages/index/index.ts");
	const homeTemplate = await source("pages/index/index.wxml");
	const my = await source("pages/my/my.ts");
	const myTemplate = await source("pages/my/my.wxml");

	expect(home).toContain("onRetry(): void");
	expect(home).toContain("void this.onRefresh()");
	expect(homeTemplate).toContain('class="error-message-retry"');
	expect(homeTemplate).toContain('bindtap="onRetry"');
	expect(my).toContain("onRetry(): void");
	expect(my).toContain("void this.loadPage(true)");
	expect(myTemplate).toContain('class="error-message-retry"');
	expect(myTemplate).toContain('bindtap="onRetry"');
});

test("patient selection does not silently sync the provider on page entry", async () => {
	const selection = await source("pages/patient-select/patient-select.ts");

	// 进入选择页只读取已经落库的 owner-scoped 目录；没有 ready 映射时，
	// 只能展示明确提示，不能因为一次页面导航自动发起 Provider POST。
	expect(selection).toContain(
		'loading: true,\n\t\t\tsyncing: false,\n\t\t\tselectionReady: false,\n\t\t\tselectedPatientId: "",',
	);
	expect(selection).toContain("this.setPatientList(patients, true);");
	expect(selection).toContain(
		"resolvePatientSelection(patients, getSelectedPatientId())",
	);
	expect(selection).toContain("自动发起 POST /patients/sync");
	const loadStart = selection.indexOf("loadPatientList(): Promise<void>");
	const loadEnd = selection.indexOf("\n\t},", loadStart);
	const loadBody = selection.slice(loadStart, loadEnd);
	expect(loadBody).not.toContain("syncPatientDirectoryForLoad(loadToken)");
	expect(selection).not.toContain(
		"this.setData({ selectedPatientId: getSelectedPatientId() });",
	);
});

test("native patient synchronization is single-flight at both entry pages", async () => {
	const home = await source("pages/index/index.ts");
	const selection = await source("pages/patient-select/patient-select.ts");
	const coordinator = await source("services/patient-sync-coordinator.ts");
	const sessionGeneration = await source("services/session-generation.ts");

	// WXML disabled 只能降低重复点击概率，不能约束生命周期回调或真机重复事件。
	// 两个入口都必须在方法层复用同一个 Promise；跨进程最终幂等仍由服务端保证。
	expect(home).toContain("getPageSingleFlight<");
	expect(home).toContain(
		'Exclude<PatientBootstrapResult, "skipped" | "directory-loaded">',
	);
	expect(home).toContain("return patientSyncFlight.run(() => {");
	expect(selection).toContain("getPageSingleFlight<Array<Patient>>");
	expect(selection).toContain(".run(() =>");
	expect(selection).toContain('"patient-list-load"');
	expect(selection).toContain(
		'syncPatientsFromHospital("patient-selection-sync")',
	);
	expect(selection).toContain("后发调用方仍要消费同一个患者数组");
	// 同步内部的 /me 可能在 401 后安全恢复会话并推进代际；页面只能在
	// 成功快照和当前页面令牌均确认后记录代际，不能在 Promise 发起前固定旧代际。
	const syncBodyStart = selection.indexOf(
		"syncPatientDirectoryForLoad(loadToken: number)",
	);
	const syncBody = selection.slice(syncBodyStart);
	const sessionMarkIndex = syncBody.indexOf(
		"markPatientSelectionSession(this)",
	);
	const syncResultIndex = syncBody.indexOf(".then((patients) => {");
	const pageGuardIndex = syncBody.indexOf(
		"!listLoadGuard.isCurrent(loadToken)",
	);
	expect(sessionMarkIndex).toBeGreaterThan(syncResultIndex);
	expect(sessionMarkIndex).toBeGreaterThan(pageGuardIndex);
	expect(home).toContain("patient-sync:");
	expect(home).toContain("getSessionGeneration()");
	expect(selection).toContain("patient-sync:");
	expect(selection).toContain("getSessionGeneration()");
	expect(coordinator).toContain("patientSyncFlights");
	expect(coordinator).toContain("getSessionGeneration");
	expect(sessionGeneration).toContain("advanceSessionGeneration");
	// 页面/进程 single-flight 必须随会话代际隔离，不能把旧账号的患者快照
	// 交给新账号；token 本身不允许进入协调器的 key 或测试输出。
	expect(coordinator).not.toContain("accessToken");
});

test("native data pages keep first-show state on the page instance", async () => {
	const pageFiles = [
		"pages/index/index.ts",
		"pages/appointment-records/appointment-records.ts",
		"pages/missed-appointments/missed-appointments.ts",
		"pages/report-directory/report-directory.ts",
		"pages/outpatient-payment/outpatient-payment.ts",
		"pages/my/my.ts",
		"pages/profile/profile.ts",
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

test("patient-scoped read pages share one current-patient gate", async () => {
	const dashboard = await source("services/dashboard-service.ts");
	const pages = [
		{
			file: "pages/appointment-records/appointment-records.ts",
			call: "loadAppointmentRecords(",
			method: "loadRecords(tab?: AppointmentRecordTab): Promise<void>",
		},
		{
			file: "pages/missed-appointments/missed-appointments.ts",
			call: "loadAppointmentRecords(",
			method: "loadRecords(): Promise<void>",
		},
		{
			file: "pages/report-directory/report-directory.ts",
			call: "loadReports(",
			method: "loadPage(): Promise<void>",
		},
		{
			file: "pages/outpatient-payment/outpatient-payment.ts",
			call: "loadOutpatientPaymentRecords(",
			method: "loadPage(): Promise<void>",
		},
	] as const;

	// 这四个页面都属于患者上下文业务页：只能读取最新 owner 目录并解析
	// ready 患者，不能各自复制默认/stale/unavailable 分支或偷偷触发同步。
	expect(dashboard).toContain("export function loadCurrentPatient");
	expect(dashboard).toContain("export function loadCurrentPatientForOwner");
	expect(dashboard).toContain("Current owner changed while reading patients");
	expect(dashboard).toContain("requireStoredPatientSelection(patients)");
	expect(dashboard).toContain("不隐式调用");
	for (const item of pages) {
		const page = await source(item.file);
		const pageImplementationStart = page.indexOf("Page<");
		const loadStart = page.indexOf(item.method, pageImplementationStart);
		// 从方法起点截取到文件末尾即可：业务加载调用只会出现在该方法后，
		// 不依赖具体缩进和对象结束符，避免格式化后静态断言失效。
		const loadBody = page.slice(loadStart);
		const patientGateIndex = loadBody.indexOf(
			"loadCurrentPatientForOwner(expectedOwnerId)",
		);
		const businessLoaderIndex = loadBody.indexOf(item.call);

		expect(page).toContain("loadCurrentPatient");
		expect(page).toContain("expectedOwnerId");
		expect(page).toContain("patientContextErrorMessage");
		// 页面实例守卫只能防同页刷新；跨页面更换就诊人后，旧请求还必须
		// 通过本地 opaque patientId 快照校验，才能把结果写回当前页面。
		expect(page).toContain("isCurrentSelectedPatient");
		expect(page).not.toContain("loadPatients");
		expect(page).not.toContain("requireStoredPatientSelection");
		expect(page).toContain("navigateToPatientSelector");
		expect(patientGateIndex).toBeGreaterThanOrEqual(0);
		expect(businessLoaderIndex).toBeGreaterThan(patientGateIndex);
	}
});

test("patient-scoped pages clear stale snapshots when the session changes", async () => {
	const pages = [
		"pages/appointment-records/appointment-records.ts",
		"pages/missed-appointments/missed-appointments.ts",
		"pages/report-directory/report-directory.ts",
		"pages/outpatient-payment/outpatient-payment.ts",
		"pages/report-detail/report-detail.ts",
	] as const;

	for (const file of pages) {
		const page = await source(file);
		// 这些页面都可能在页面栈中停留；会话轮换时必须先清理本地患者
		// 读模型，不能等下一次网络请求完成后才撤掉旧预约、金额或报告。
		expect(page).toContain("registerPageSessionResetListener(this");
		expect(page).toContain("disposePageSessionResetListener(this)");
		expect(page).toContain("登录账号已切换");
	}

	const detail = await source("pages/report-detail/report-detail.ts");
	// 详情页还必须清除深链引用，否则旧 reportId 仍可能被重试按钮重新提交。
	expect(detail).toContain('sourcePatientId: ""');
	expect(detail).toContain('sourceReportId: ""');
});

test("patient-bearing entry pages clear stale UI on a session event", async () => {
	const pages = [
		{
			file: "pages/index/index.ts",
			clearMethod: "clearDisplayedPatientContext",
		},
		{
			file: "pages/my/my.ts",
			clearMethod: "selectedPatient: null",
		},
		{
			file: "pages/consult/consult.ts",
			clearMethod: "records: []",
		},
		{
			file: "pages/profile/profile.ts",
			clearMethod: "clearDisplayedProfileContext",
		},
		{
			file: "pages/patient-select/patient-select.ts",
			clearMethod: "clearDisplayedPatientDirectory",
		},
		{
			file: "pages/patient-signature/patient-signature.ts",
			clearMethod: "patients: []",
		},
	] as const;

	for (const item of pages) {
		const page = await source(item.file);
		// 这些入口不是只有“下一次 onShow 再刷新”这么简单：它们可能正在
		// 屏幕上展示患者姓名、脱敏卡号、二维码或资料表单。会话事件到达后，
		// 必须先撤销旧 owner 的 UI 快照，再等待用户或生命周期重新读取。
		expect(page).toContain("registerPageSessionResetListener(this");
		expect(page).toContain("disposePageSessionResetListener(this)");
		expect(page).toContain(item.clearMethod);
		expect(page).toContain("登录账号已切换");
	}
});

test("patient-scoped API reads pin the session generation at the request boundary", async () => {
	const client = await source("services/api-client.ts");
	const dashboard = await source("services/dashboard-service.ts");
	const detail = await source("pages/report-detail/report-detail.ts");

	// 页面先做断言并不足够：普通 GET 可能在两次同步调用之间自动换号，
	// 把上一轮解析出的 patientId 带入新会话。患者范围 API 必须统一进入
	// 固定代际的只读请求入口，且报告详情也不能遗漏这一层。
	expect(client).toContain("export async function requestWithStableSession");
	expect(client).toContain(
		"Stable session request only supports authenticated GET reads",
	);
	for (const functionName of [
		"requestAppointmentRecords",
		"requestOutpatientPaymentRecords",
		"requestReports",
		"requestReportDetail",
	] as const) {
		const functionStart = client.indexOf(`export function ${functionName}`);
		const functionBody = client.slice(functionStart);
		expect(functionBody).toContain("requestWithStableSession");
		expect(functionBody).toContain("expectedSessionGeneration");
	}
	expect(dashboard).toContain("expectedSessionGeneration: number");
	expect(detail).toContain("expectedSessionGeneration,\n\t\t\t\t);");
});

test("患者范围页面区分会话失效与业务读取失败", async () => {
	const pages = [
		"pages/appointment-records/appointment-records.ts",
		"pages/missed-appointments/missed-appointments.ts",
		"pages/report-directory/report-directory.ts",
		"pages/outpatient-payment/outpatient-payment.ts",
		"pages/my/my.ts",
	] as const;

	for (const file of pages) {
		const page = await source(file);
		// `/me` 成功后的患者/报告/费用读取失败，不能把“未选患者”或
		// Provider 暂时故障错误地降级成不可导航的 unavailable；只有 401、
		// session-changed 或恢复后确实没有 token 才改变入口门禁。
		expect(page).toContain("sessionStateAfterAuthenticatedReadError");
		expect(page).toContain("hasPlatformSession()");
	}
});

test("患者范围只读页面开始新查询前统一清空旧读模型", async () => {
	const pages = [
		{
			file: "pages/appointment-records/appointment-records.ts",
			method: "loadRecords(tab?: AppointmentRecordTab): Promise<void>",
			fields: [
				"selectedPatient: null",
				"records: []",
				"visibleRecords: []",
				"visibleRecordCount: 0",
				"hasMoreRecords: false",
			],
		},
		{
			file: "pages/missed-appointments/missed-appointments.ts",
			method: "loadRecords(): Promise<void>",
			fields: [
				"selectedPatient: null",
				"records: []",
				"visibleRecords: []",
				"visibleRecordCount: 0",
				"hasMoreRecords: false",
			],
		},
		{
			file: "pages/report-directory/report-directory.ts",
			method: "loadPage(): Promise<void>",
			fields: [
				"selectedPatient: null",
				"reports: []",
				"visibleReports: []",
				"reportCount: 0",
				"visibleReportCount: 0",
				"hasMoreReports: false",
			],
		},
		{
			file: "pages/outpatient-payment/outpatient-payment.ts",
			method: "loadPage(): Promise<void>",
			fields: [
				"selectedPatient: null",
				"items: []",
				"visibleItems: []",
				"visibleItemCount: 0",
				"hasMoreItems: false",
			],
		},
	] as const;

	for (const item of pages) {
		const page = await source(item.file);
		const pageStart = page.indexOf("Page<");
		const loadStart = page.indexOf(item.method, pageStart);
		const loadEnd = page.indexOf("\n\t},", loadStart);
		const loadBody = page.slice(loadStart, loadEnd);

		// 患者切换、下拉刷新或重试开始后，旧卡片和旧列表不能继续与新一轮
		// owner-scoped 请求并存；否则加载中的页面会把上一位患者的临床事实
		// 误显示成当前结果。该规则只检查页面状态清理，不替代运行时 guard。
		expect(loadStart).toBeGreaterThanOrEqual(0);
		expect(loadEnd).toBeGreaterThan(loadStart);
		for (const field of item.fields) expect(loadBody).toContain(field);
	}
});

test("report detail reuses the shared patient context error translation", async () => {
	const page = await source("pages/report-detail/report-detail.ts");

	// 详情页的患者参数和响应都经过当前 patientId 校验；错误文案也必须
	// 回到同一个患者上下文翻译入口，不能因为它没有列表 loader 就绕过
	// patientContextErrorMessage，导致 patient-selection-required 等错误在
	// 不同页面出现不同提示。
	expect(page).toContain("patientContextErrorMessage(error,");
	expect(page).not.toContain("safeApiErrorMessage(error");
});

test("native report directory errors clear list-derived counters", async () => {
	const page = await source("pages/report-directory/report-directory.ts");
	const showErrorStart = page.indexOf(
		"showError(error: unknown, fallback: string): void",
	);
	const showErrorEnd = page.indexOf("\n\t},", showErrorStart);
	const showErrorBody = page.slice(showErrorStart, showErrorEnd);

	// 报告目录失败后，报告条数和加载更多标记必须与列表一起失效；否则
	// 页面可能在错误态继续展示上一轮患者的统计信息或触发旧数据分页。
	expect(showErrorBody).toContain("reportCount: 0");
	expect(showErrorBody).toContain("visibleReportCount: 0");
	expect(showErrorBody).toContain("hasMoreReports: false");
});

test("missed appointments commit the patient card with the filtered result", async () => {
	const page = await source("pages/missed-appointments/missed-appointments.ts");
	const loadStart = page.indexOf("loadRecords(): Promise<void>");
	const loadBody = page.slice(loadStart);
	const providerIndex = loadBody.indexOf("loadAppointmentRecords(");
	const resultGateIndex = loadBody.indexOf(
		"isCurrentSelectedPatient(result.patient.id)",
	);
	const patientCommitIndex = loadBody.indexOf("selectedPatient: patient");

	// 爽约页必须把患者卡片和同一轮已筛选记录一起提交；不能在 provider
	// 请求尚未完成时先画卡片，再让旧患者的卡片残留在新患者页面上。
	expect(providerIndex).toBeGreaterThanOrEqual(0);
	expect(resultGateIndex).toBeGreaterThan(providerIndex);
	expect(patientCommitIndex).toBeGreaterThan(resultGateIndex);
	expect(loadBody).toContain("const { patient, records } = result;");
});

test("report and outpatient pages commit patient cards with read-only results", async () => {
	const report = await source("pages/report-directory/report-directory.ts");
	const reportLoad = report.slice(report.indexOf("loadPage(): Promise<void>"));
	const reportProviderIndex = reportLoad.indexOf("loadReports(");
	const reportGateIndex = reportLoad.indexOf(
		"isCurrentSelectedPatient(result.patient.id)",
	);
	const reportCommitIndex = reportLoad.indexOf("selectedPatient: patient");

	const outpatient = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);
	const outpatientPageStart = outpatient.indexOf("loadPage(): Promise<void> {");
	const outpatientRecordsStart = outpatient.indexOf(
		"\n\tasync loadRecords(\n",
		outpatientPageStart,
	);
	const outpatientPageLoad = outpatient.slice(
		outpatientPageStart,
		outpatientRecordsStart,
	);
	const outpatientPatientContextIndex = outpatientPageLoad.indexOf(
		"patientSessionGeneration: expectedSessionGeneration",
	);
	const outpatientInitialLoadIndex = outpatientPageLoad.indexOf(
		"return this.loadRecords(",
	);
	const outpatientRecordsLoad = outpatient.slice(outpatientRecordsStart);
	const outpatientProviderIndex = outpatientRecordsLoad.indexOf(
		"loadOutpatientPaymentRecords(",
	);
	const outpatientGateIndex = outpatientRecordsLoad.lastIndexOf(
		"isCurrentSelectedPatient(patient.id)",
	);
	const outpatientCommitIndex = outpatientRecordsLoad.indexOf(
		"selectedPatient: patient",
	);

	// 这三个页面都属于患者范围只读业务：报告页和费用列表只有和对应
	// 业务结果一起通过当前请求/当前选择校验后才能提交，避免切换期间
	// 上下文错配；费用页在目录确认后即可先提交患者上下文，保证费用
	// 请求进行期间的 tab 切换不会被误判为“尚未选择患者”。
	expect(reportProviderIndex).toBeGreaterThanOrEqual(0);
	expect(reportGateIndex).toBeGreaterThan(reportProviderIndex);
	expect(reportCommitIndex).toBeGreaterThan(reportGateIndex);
	expect(outpatientPageLoad).toContain("selectedPatient: patient");
	expect(outpatientInitialLoadIndex).toBeGreaterThan(
		outpatientPatientContextIndex,
	);
	expect(outpatientProviderIndex).toBeGreaterThanOrEqual(0);
	expect(outpatientGateIndex).toBeGreaterThan(outpatientProviderIndex);
	expect(outpatientCommitIndex).toBeGreaterThan(outpatientGateIndex);
});

test("患者范围页面把会话代际贯穿到患者和业务结果提交", async () => {
	const pageFiles = [
		"pages/appointment-records/appointment-records.ts",
		"pages/missed-appointments/missed-appointments.ts",
		"pages/report-directory/report-directory.ts",
		"pages/outpatient-payment/outpatient-payment.ts",
	] as const;

	for (const file of pageFiles) {
		const page = await source(file);
		// 每个页面都必须在 `/me` 成功后捕获当前代际，并在患者上下文和
		// 业务列表准备提交时再次校验；单纯的 page request guard 不能覆盖
		// 另一个页面完成账号切换的情况。
		expect(page).toContain("let expectedSessionGeneration = -1");
		expect(page).toContain(
			"expectedSessionGeneration = getSessionGeneration()",
		);
		expect(page).toContain("assertSessionGeneration(");
	}

	const detail = await source("pages/report-detail/report-detail.ts");
	// 详情深链也要先重建当前 owner 的患者目录，不能只用 URL 和旧 storage
	// 中的 patientId 直接请求报告详情。
	expect(detail).toContain("getCurrentUser()");
	expect(detail).toContain(
		"return loadCurrentPatientForOwner(expectedOwnerId)",
	);
	expect(detail).toContain("currentPatient.id !== patientId");
	expect(detail).toContain("assertSessionGeneration(");
});

test("患者范围只读页面阻断跨会话本地列表事件", async () => {
	const pageFiles = [
		"pages/appointment-records/appointment-records.ts",
		"pages/missed-appointments/missed-appointments.ts",
		"pages/report-directory/report-directory.ts",
	] as const;

	for (const file of pageFiles) {
		const page = await source(file);
		// 患者卡片提交时必须保存会话代际，不能只保存 patientId；账号切换后
		// 即使偶然复用同一个 opaque patientId，旧页面也必须失去本地事件资格。
		expect(page).toContain("patientSessionGeneration: -1");
		expect(page).toContain(
			"patientSessionGeneration: expectedSessionGeneration",
		);
		expect(page).toContain("isPatientContextCurrent(): boolean");
		expect(page).toContain(
			"this.data.patientSessionGeneration === getSessionGeneration()",
		);
		expect(page).toContain("void this.load");
	}
});

test("native my page separates ordinary profile from family patient selection", async () => {
	const app = await source("app.json");
	const home = await source("pages/index/index.ts");
	const my = await source("pages/my/my.ts");
	const template = await source("pages/my/my.wxml");
	const profile = await source("pages/profile/profile.ts");
	const profileTemplate = await source("pages/profile/profile.wxml");
	const client = await source("services/api-client.ts");
	const navigation = await source("services/patient-navigation.ts");
	const featureNavigation = await source("services/feature-navigation.ts");
	const build = await Bun.file(join(import.meta.dir, "build.ts")).text();

	expect(app).toContain('"pages/profile/profile"');
	expect(my).toContain("navigateToAuthenticatedPage");
	expect(my).toContain('"/pages/profile/profile"');
	expect(my).toContain('sessionState: "checking"');
	expect(my).toContain("sessionVerificationStateFromError");
	expect(my).toContain('sessionState: "valid"');
	expect(my).toContain("waitForGlobalUserProfile");
	expect(my).toContain("subscribeGlobalUserProfile");
	expect(my).toContain("hasPlatformSession");
	expect(my).toContain("getGlobalUserProfile");
	expect(my).toContain("loadPatientsForOwner(expectedOwnerId)");
	expect(my).toContain("登录状态已变化，请下拉刷新后重试");
	// `/me` 和 `/me/profile` 已经由 App 全局仓库单飞完成；“我的”页只等待
	// 这份快照，再独立刷新患者目录，避免每次切换 Tab 重复获取个人资料。
	const myLoadStart = my.indexOf("loadPage(): Promise<void>");
	const dependentReadsStart = my.indexOf(
		"return loadPatientsForOwner(expectedOwnerId)",
		myLoadStart,
	);
	expect(dependentReadsStart).toBeGreaterThan(myLoadStart);
	expect(my).not.toContain("return getUserProfile()");
	expect(my).not.toContain("myPageProfileContexts");
	expect(my).toContain("!hasPlatformSession()");
	expect(my).toContain("patientCount: 0");
	expect(my).not.toContain("Promise.all([loadPatients(), profileResult])");
	// 全局资料和患者目录仍分别经过 owner/代际边界，任何中途换号都必须
	// 停止页面回写，不能把旧 owner 资料和新 owner 患者拼接。
	expect(my).toContain("患者请求在 Promise 完成后、setData 前");
	expect(my).toContain(
		"if (!pageLoadGuard.isCurrent(requestToken)) return undefined;",
	);
	expect(my).toContain("patientSelectionResolutionMessage");
	expect(my).toContain("patientContextErrorMessage");
	expect(my).toContain("patientContextError || this.data.error");
	expect(my).toContain("navigateToPatientSelector");
	expect(navigation).toContain('url: "/pages/patient-select/patient-select"');
	expect(navigation).toContain("resolveAuthenticatedEntry");
	expect(navigation).toContain("登录状态验证中，请稍后");
	// 入口必须显式接收 `/me` 四态验证结果；不能退回“本地 token 存在就放行”
	// 的兼容默认值，否则服务端已失效的会话仍可能进入患者选择页。
	expect(navigation).toContain("state: AuthenticatedEntryState");
	expect(navigation).not.toContain("hasPlatformSession()");
	expect(app).toContain('"pagePath": "pages/index/index"');
	expect(app).toContain('"pagePath": "pages/consult/consult"');
	expect(app).toContain('"pagePath": "pages/hospital/hospital"');
	expect(app).toContain('"pagePath": "pages/my/my"');
	expect(template).toContain('bindtap="onFamilyTap"');
	expect(template).toContain('bindtap="onHeaderTap"');
	// 视觉以旧端为准；头像资源仍使用本地默认图，真实头像只能来自用户
	// 主动授权后的当前 owner 快照，不能在登录 loading 中偷偷请求。
	expect(template).toContain("/assets/legacy-user/legacy-user-background.png");
	expect(template).toContain('bindtap="onWechatProfileTap"');
	expect(template).toContain(
		"avatarUrl || '/assets/legacy-user/default-avatar.svg'",
	);
	expect(my).toContain("authorizeGlobalWechatProfile");
	expect(await source("services/global-user-profile.ts")).toContain(
		"头像和昵称已显示，资料同步失败",
	);
	expect(template).toContain('mode="widthFix"');
	expect(await source("pages/my/my.wxss")).toContain("height: 566rpx");
	expect(template).toContain("/assets/legacy-user/default-avatar.svg");
	expect(template).toContain("{{section.title}}");
	expect(template).toContain('src="{{item.icon}}" mode="aspectFill"');
	// 旧端菜单的 `gap-20rpx` 同时约束行、列，不能只保留行间距。
	expect(await source("pages/my/my.wxss")).toContain("column-gap: 20rpx;");
	expect(my).toContain('title: "我的订单"');
	expect(template).toContain('data-action="{{item.action}}"');
	// 每个菜单入口都有稳定 action，未完成能力进入统一状态页；不能拿 action
	// 做 WXML key，因为后续业务扩展可能出现同 action 的不同展示项。
	expect(template).toContain('wx:key="title"');
	expect(template).not.toContain('wx:key="action"');
	// 原版菜单的顺序、标题和图标属于可见业务契约；这里只允许使用仓库内
	// 已核对过的本地图标，避免后续会话只保留文字或重新设计入口顺序。
	for (const item of [
		["appointment-records", "appointment.svg", "我的挂号"],
		["consultation", "consultation.svg", "我的问诊"],
		["medical-record", "medical-record.svg", "门诊病历"],
		["electronic-consultation", "electronic-consultation.svg", "电子导诊单"],
		["doctor", "doctor.svg", "我的医生"],
		["missed-appointments", "missed.svg", "爽约记录"],
		["feedback", "feedback.svg", "意见反馈"],
		["smart-customer", "smart-customer.svg", "智能客服"],
		["insurance", "insurance.svg", "医保电子凭证"],
	] as const) {
		const [action, icon, title] = item;
		expect(my).toContain(`action: "${action}"`);
		expect(my).toContain(`icon: "/assets/legacy-user/${icon}"`);
		expect(my).toContain(`title: "${title}"`);
	}
	// 四个主入口交给微信原生 tabBar 管理；页面自身不能复制底栏，
	// 激活态由共享组件按当前路由维护，避免页面生命周期互相覆盖选中态。
	expect(template).not.toContain("legacy-tabbar");
	expect(app).toContain('"custom": false');
	expect(app).toContain('"position": "bottom"');
	expect(app).toContain(
		'"selectedIconPath": "assets/legacy-home/tab-04-native-active-v6.png"',
	);
	expect(template).not.toContain('wx:for="{{tabBarItems}}"');
	expect(await source("pages/index/index.wxss")).not.toContain(
		".legacy-tabbar {",
	);
	expect(await source("pages/my/my.wxss")).not.toContain(".legacy-tabbar {");
	expect(app).toContain('"pages/consult/consult"');
	expect(app).toContain('"pages/hospital/hospital"');
	expect(build).toContain("native tabBar");
	expect(my).toContain('title: "电子导诊单"');
	expect(my).toContain('action: "electronic-consultation"');
	expect(my).toContain('action: "smart-customer"');
	expect(my).toContain('title: "智能客服"');
	expect(my).toContain('case "electronic-consultation"');
	expect(my).toContain('case "smart-customer"');
	expect(my).toContain("navigateToFeatureEntry");
	expect(home).toContain("onFloatingGuide");
	expect(home).toContain('navigateToFeatureEntry("smart-customer")');
	expect(home).not.toContain('title: "智能客服功能迁移中"');
	expect(featureNavigation).toContain("医保电子凭证需要独立授权");
	expect(featureNavigation).toContain("FEATURE_STATUS_CATALOG");
	expect(featureNavigation).toContain("encodeURIComponent(feature)");
	for (const feature of [
		'"appointment-detail"',
		'"appointment-write"',
		'"outpatient-payment-detail"',
		'"outpatient-payment-write"',
		'"patient-binding"',
		'"pre-visit"',
		'"report-cloud-image"',
		'"report-detail"',
		'"report-follow-up"',
		'"report-share"',
	] as const) {
		expect(featureNavigation).toContain(feature);
	}
	expect(profile).toContain("waitForGlobalUserProfile");
	expect(profile).toContain("applyServerUserProfile");
	expect(profile).toContain("updateUserProfile");
	expect(profile).toContain("getPageLatestRequestGuard");
	expect(profile).toContain("hasShown: false");
	expect(profile).toContain("onShow()");
	expect(profile).toContain("页面重新可见时不能只看本地 token");
	expect(profile).toContain("this.data.saving || this.data.navigationPending");
	expect(profile).toContain("不能再启动 GET");
	expect(profile).toContain("profileLoadGuard.isCurrent(requestToken)");
	expect(profile).toContain("this.data.version");
	expect(profile).toContain("sessionGeneration");
	expect(profile).toContain("state.sessionGeneration");
	expect(profile).toContain("isCurrentSessionGeneration");
	expect(profile).toContain("profileSessionChangedError");
	expect(profile).toContain(
		"if (this.data.saving || this.data.navigationPending)",
	);
	expect(profile).toContain("onUnload");
	expect(profile).toContain("navigationPending");
	expect(profile).toContain("profileNavigationTimers");
	expect(profile).toContain("clearTimeout(navigationTimer)");
	expect(profile).toContain("profileNavigationTimers.delete(this)");
	expect(profile).toContain('getPageLatestRequestGuard(this, "profile-save")');
	expect(profile).toContain("if (!saveGuard.isCurrent(saveToken)) return;");
	expect(profile).toContain("disposePageInstance(this)");
	expect(profile).toContain("Number.isInteger(rawIndex)");
	expect(profile).toContain("if (!this.data.navigationPending) return;");
	expect(profile).toContain("尚未加载完成");
	expect(profile).not.toContain("openid");
	expect(profile).not.toContain("unionid");
	expect(profile).not.toContain("idCard");
	expect(profile).not.toContain("avatar");
	expect(profileTemplate).toContain("头像、手机号、真实姓名和身份证");
	// 暂时保存失败会保留已确认的 canonical 资料；不能让一个 error 字符串
	// 把表单隐藏，导致页面状态与 profile.ts 的安全重试语义相互矛盾。
	expect(profileTemplate).toContain('wx:if="{{loading || !loaded}}"');
	expect(profileTemplate).not.toContain(
		'wx:if="{{loading || error || !loaded}}"',
	);
	expect(profileTemplate).toContain(
		'disabled="{{saving || loading || navigationPending}}"',
	);
	expect(client).toContain('url: "/me/profile"');
	expect(build).toContain("profile/profile.js");
});

test("native primary tabs keep one stable selected bar", async () => {
	const app = JSON.parse(await source("app.json")) as {
		pages: string[];
		tabBar?: {
			custom?: boolean;
			position?: string;
			list?: Array<{
				pagePath: string;
				text: string;
				iconPath: string;
				selectedIconPath: string;
			}>;
		};
	};
	const indexTemplate = await source("pages/index/index.wxml");
	const myTemplate = await source("pages/my/my.wxml");
	const build = await Bun.file(join(import.meta.dir, "build.ts")).text();
	const projectConfig = JSON.parse(
		await Bun.file(join(import.meta.dir, "..", "project.config.json")).text(),
	) as { setting?: { compileHotReLoad?: boolean } };
	const privateProjectConfig = JSON.parse(
		await Bun.file(
			join(import.meta.dir, "..", "project.private.config.json"),
		).text(),
	) as { miniprogramRoot?: string; setting?: { compileHotReLoad?: boolean } };
	const tabList = app.tabBar?.list ?? [];
	// 原生 tabBar 由微信运行时持有，是四个 tab 页共享的唯一底栏；页面自身
	// 不再创建固定底栏，因此切换时不会出现第二套底栏或页面级底栏闪动。
	expect(app.tabBar?.custom).toBe(false);
	expect(app.tabBar?.position).toBe("bottom");
	for (const page of [
		"pages/index/index.ts",
		"pages/consult/consult.ts",
		"pages/hospital/hospital.ts",
		"pages/my/my.ts",
	] as const) {
		expect(await source(page)).not.toContain("syncPrimaryTabSelected");
	}
	expect(projectConfig.setting?.compileHotReLoad).toBe(false);
	const runtimeProjectConfig = JSON.parse(
		await Bun.file(
			join(import.meta.dir, "..", "dist", "project.config.json"),
		).text(),
	) as {
		miniprogramRoot?: string;
		setting?: {
			compileHotReLoad?: boolean;
			ignoreDevUnusedFiles?: boolean;
		};
	};
	expect(runtimeProjectConfig.miniprogramRoot).toBe("./");
	expect(runtimeProjectConfig.setting?.compileHotReLoad).toBe(false);
	expect(runtimeProjectConfig.setting?.ignoreDevUnusedFiles).toBe(false);
	// 本机私有配置也必须指向同一份 dist；否则开发者工具可能把旧的 src
	// 增量页面图当成当前候选，正是底栏闪动和 selected 图标消失的表现。
	expect(privateProjectConfig.miniprogramRoot).toBe("dist/");
	expect(privateProjectConfig.setting?.compileHotReLoad).toBe(false);
	expect(tabList.map((item) => item.text)).toEqual([
		"医疗服务",
		"就诊",
		"互联网医院",
		"我的",
	]);
	expect(tabList).toHaveLength(4);
	// 主 Tab 固定在页面注册表最前面：这样首屏和四项切换都沿用同一组
	// 根页面，不让开发者工具把“我的”当成普通业务页重新创建底栏实例。
	expect(app.pages.slice(0, 4)).toEqual(tabList.map((item) => item.pagePath));
	for (const item of tabList) {
		expect(app.pages).toContain(item.pagePath);
		expect(item.iconPath).toContain("assets/legacy-home/");
		expect(item.selectedIconPath).toContain("assets/legacy-home/");
		expect(item.selectedIconPath).not.toBe(item.iconPath);
		const normalIcon = await Bun.file(
			join(import.meta.dir, "..", "src", item.iconPath),
		).bytes();
		const selectedIcon = await Bun.file(
			join(import.meta.dir, "..", "src", item.selectedIconPath),
		).bytes();
		// 不能只比较路径：复制同一张 PNG 后，微信仍会正常加载资源，
		// 但用户切换 Tab 时永远看不到选中态。
		expect(normalIcon).not.toEqual(selectedIcon);
	}
	// 主 Tab 即使被未来快捷入口程序化打开，也必须走 switchTab；普通业务页
	// 继续使用 navigateTo，不能用一个全局替换把两类页面混在一起。
	for (const path of tabList.map((item) => item.pagePath)) {
		for (const pagePath of app.pages) {
			const page = await source(`${pagePath}.ts`);
			expect(page).not.toContain(`wx.navigateTo({ url: "/${path}"`);
		}
	}
	// 页面只负责自己的内容；底栏由微信原生 tabBar 统一渲染。
	expect(indexTemplate).not.toContain("legacy-tabbar");
	expect(myTemplate).not.toContain("legacy-tabbar");
	expect(await source("pages/index/index.ts")).not.toContain("onTabBarAction");
	expect(await source("pages/my/my.ts")).not.toContain("onTabTap");
	expect(await source("app.json")).toContain('"custom": false');
	// 原生 tabBar 不接受其他框架的尺寸字段；尺寸由微信运行时管理，
	// 不能把 height/fontSize/iconWidth/spacing 混进 app.json 造成假配置。
	expect(Object.keys(app.tabBar ?? {}).sort()).toEqual([
		"backgroundColor",
		"borderStyle",
		"color",
		"custom",
		"list",
		"position",
		"selectedColor",
	]);
	expect(app.tabBar).not.toHaveProperty("height");
	expect(app.tabBar).not.toHaveProperty("fontSize");
	expect(app.tabBar).not.toHaveProperty("iconWidth");
	expect(app.tabBar).not.toHaveProperty("spacing");
	expect(await source("app.wxss")).toContain(
		"padding-bottom: calc(130rpx + env(safe-area-inset-bottom));",
	);
	expect(build).toContain("native tabBar");
	expect(build).toContain("selectedIconPath");
	expect(build).toContain("compileHotReLoad=false");
});

test("native primary tab pages keep a stable patient header during session refresh", async () => {
	const home = await source("pages/index/index.wxml");
	const homeStyle = await source("pages/index/index.wxss");
	const my = await source("pages/my/my.wxml");
	const homeScript = await source("pages/index/index.ts");

	// 会话恢复时必须先撤销旧患者，再以固定两行占位承接异步读取；不能为了
	// 消除闪动而继续展示上一账号的患者，也不能让患者卡片发生高度跳变。
	expect(home).toContain("patient-card-pending");
	expect(homeStyle).toContain("min-height: 72rpx");
	expect(homeScript).toContain("sessionStatus: SESSION_LABELS.restoring");
	expect(homeScript).toContain("selectedPatient: null");
	expect(my).toContain('{{userLabel || "微信用户"}}');
	expect(my).toContain("全局资料仓库");
});

test("consult and internet hospital tabs keep unfinished external contracts closed", async () => {
	const app = JSON.parse(await source("app.json")) as {
		tabBar?: { list?: Array<{ pagePath: string }> };
	};
	const consult = await source("pages/consult/consult.ts");
	const consultTemplate = await source("pages/consult/consult.wxml");
	const hospital = await source("pages/hospital/hospital.ts");
	const hospitalTemplate = await source("pages/hospital/hospital.wxml");

	// 这两个页面虽然已经是正式主 Tab，但页面入口存在不等于业务 contract
	// 已冻结。门禁直接阻止旧端 WebSocket、队列直连和 provider 患者号回到新端。
	const tabPages = app.tabBar?.list?.map((item) => item.pagePath) ?? [];
	expect(tabPages).toContain("pages/consult/consult");
	expect(tabPages).toContain("pages/hospital/hospital");
	expect(consult).not.toContain("connectWebSocket");
	expect(consult).not.toContain("VITE_APP_WS_API");
	expect(consult).not.toContain("shift-scheduling/queue-position");
	expect(consult).not.toContain("msun-middle-business-appointment-server");
	expect(consult).not.toContain("thirdPatientId");
	expect(consultTemplate).not.toContain("<web-view");
	expect(consultTemplate).toContain("智能陪诊");
	expect(consultTemplate).toContain("实时就诊 contract 尚未完成");
	expect(consult).toContain("loadAppointmentRecords");
	expect(consultTemplate).toContain("当前仅展示预约摘要");
	expect(consultTemplate).toContain("query-state-shell");

	// 互联网医院属于独立外部 audience：没有 resourceKey、allowlist、短期
	// 一次性引用和回调审计之前，不能把旧固定地址或万能 WebView 复活。
	expect(hospital).not.toContain("webViewUrl");
	expect(hospital).not.toContain("cx.o2o.bailingjk.net");
	expect(hospital).not.toContain("system/auth/ticket");
	expect(hospital).not.toContain("navigateToMiniProgram");
	expect(hospitalTemplate).not.toContain("<web-view");
	expect(hospitalTemplate).toContain("互联网医院服务正在迁移中");
	expect(hospitalTemplate).toContain("query-state-shell");
});

test("native primary tabs keep scrolling inside the content viewport", async () => {
	const app = JSON.parse(await source("app.json")) as {
		tabBar?: { list?: Array<{ pagePath: string }> };
	};
	const tabPages = app.tabBar?.list?.map((item) => item.pagePath) ?? [];
	const appStyle = await source("app.wxss");

	// 微信 page 默认负责整体滚动；如果主 Tab 只靠 fixed 底栏而不隔离内容，
	// 页面滚动时底栏会进入同一滚动边界。四个主页面必须统一使用内容 scroll-view，
	// 防止某个页面日后又回退成“整页滚动 + 底栏跟着漂移”。
	expect(tabPages).toHaveLength(4);
	expect(appStyle).toContain(".tab-page-scroll {");
	for (const pagePath of tabPages) {
		const template = await source(`${pagePath}.wxml`);
		const pageStyle = await source(`${pagePath}.wxss`);
		const pageConfig = JSON.parse(await source(`${pagePath}.json`)) as {
			disableScroll?: boolean;
		};
		// 原生底栏已经是微信独立层；如果页面自身仍可滚动，切换时会出现
		// 整页滚动边界与内容 scroll-view 竞争，表现为底栏闪动或页面整体滚动条。
		expect(pageConfig.disableScroll).toBe(true);
		expect(
			template.startsWith("\n<scroll-view") ||
				template.startsWith("<scroll-view"),
		).toBe(true);
		expect(template).toContain('class="tab-page-scroll"');
		expect(template).toContain('scroll-y="true"');
		expect(pageStyle).toContain("height: 100%;");
		expect(pageStyle).toContain("overflow: hidden;");
	}
});

test("native secondary pages keep scrolling inside one explicit content viewport", async () => {
	const app = JSON.parse(await source("app.json")) as {
		pages: string[];
	};
	const appStyle = await source("app.wxss");
	const tabPages = new Set(
		(
			JSON.parse(await source("app.json")) as {
				tabBar?: { list?: Array<{ pagePath: string }> };
			}
		).tabBar?.list?.map((item) => item.pagePath) ?? [],
	);

	// 主 Tab 与二级页面都必须关闭微信默认的页面级滚动；前者使用共享
	// tab-page-scroll，后者使用统一的 secondary-page-scroll。这样用户只会
	// 看到内容区域滚动，不会在页面层和业务列表之间遇到额外滚动边界。
	// app.json 是小程序页面事实源；广度迁移新增的 12 个关闭态入口也必须
	// 纳入构建和真机运行包，避免只更新台账而漏掉实际路由注册。
	expect(app.pages).toHaveLength(40);
	expect(appStyle).toContain(".secondary-page-scroll {");
	for (const pagePath of app.pages) {
		const template = await source(`${pagePath}.wxml`);
		const pageConfig = JSON.parse(await source(`${pagePath}.json`)) as {
			disableScroll?: boolean;
		};
		const expectedClass = tabPages.has(pagePath) ? "tab-page-scroll" : "scroll";

		expect(pageConfig.disableScroll).toBe(true);
		expect(template.trimStart().startsWith("<scroll-view")).toBe(true);
		expect(template).toContain('scroll-y="true"');
		expect(template).toMatch(new RegExp(`class="[^"]*${expectedClass}`));
	}
});

test("consult and internet hospital empty states keep the legacy vertical layout", async () => {
	const consultStyle = await source("pages/consult/consult.wxss");
	const hospitalStyle = await source("pages/hospital/hospital.wxss");

	// 两个主 Tab 当前都可能展示“迁移中/暂无记录”状态；状态内容由图片、
	// 标题和说明组成，必须明确声明纵向排列。只测到 display:flex 不够，
	// 因为 WXSS 默认 flex-direction 是 row，真机上会把状态内容横向挤压。
	expect(consultStyle).toMatch(
		/\.consult-state\s*\{[\s\S]*?flex-direction:\s*column;/,
	);
	expect(consultStyle).toMatch(
		/\.consult-state\s*\{[\s\S]*?align-items:\s*center;/,
	);
	expect(hospitalStyle).toMatch(
		/\.state-card\s*\{[\s\S]*?flex-direction:\s*column;/,
	);
	expect(hospitalStyle).toMatch(
		/\.state-card\s*\{[\s\S]*?align-items:\s*center;/,
	);
});

test("native profile clears stale fields after session ownership is lost", async () => {
	const page = await source("pages/profile/profile.ts");
	const saveStart = page.indexOf("onSave(): Promise<void>");
	const updateRequestStart = page.indexOf(
		"return updateUserProfile({",
		saveStart,
	);
	const responseStart = page.indexOf(
		".then((response) => {",
		updateRequestStart,
	);
	const responseSessionMismatchStart = page.indexOf(
		"if (!isCurrentSessionGeneration(profileSessionGeneration))",
		responseStart,
	);
	const responseClearIndex = page.indexOf(
		"this.clearDisplayedProfileContext();",
		responseSessionMismatchStart,
	);
	const saveCatchStart = page.indexOf(".catch((error) => {", saveStart);
	const clearIndex = page.indexOf(
		"this.clearDisplayedProfileContext();",
		saveCatchStart,
	);
	const showErrorIndex = page.indexOf(
		'this.showError(error, "个人资料保存失败");',
		saveCatchStart,
	);

	// 保存失败后只有在当前会话归属仍然成立时才能保留编辑态；401、账号切换
	// 或重新登录失败必须先清除旧资料，不能让上一账号资料继续作为当前事实。
	expect(page).toContain("shouldClearProfileDisplay");
	expect(page).toContain('error.code === "session-changed"');
	expect(page).toContain("if (!hasPlatformSession()) return true;");
	// 响应返回后的会话代际竞态发生在 reLaunch 之前，必须先释放 saving；
	// 不能只依赖页面最终卸载来收敛按钮状态。
	expect(responseSessionMismatchStart).toBeGreaterThan(responseStart);
	expect(responseClearIndex).toBeGreaterThan(responseSessionMismatchStart);
	expect(
		page.slice(responseSessionMismatchStart, responseClearIndex),
	).toContain("this.setData({ saving: false });");
	expect(clearIndex).toBeGreaterThan(saveCatchStart);
	expect(showErrorIndex).toBeGreaterThan(clearIndex);

	const clearMethodStart = page.indexOf("clearDisplayedProfileContext(): void");
	const clearMethodBody = page.slice(clearMethodStart);
	expect(clearMethodBody).toContain('displayName: ""');
	expect(clearMethodBody).toContain('gender: "unknown"');
	expect(clearMethodBody).toContain("version: 0");
	expect(clearMethodBody).toContain("loaded: false");
	expect(clearMethodBody).toContain("saving: false");
});

test("native profile save keeps validation, version and conflict boundaries ordered", async () => {
	const profile = await source("pages/profile/profile.ts");
	const profileTemplate = await source("pages/profile/profile.wxml");
	// 文件顶部的 PageMethods 类型也有同名签名；必须从 Page 实现开始截取，
	// 否则断言可能只检查类型声明而没有覆盖真实的保存流程。
	const pageImplementationStart = profile.indexOf("Page<");
	const saveStart = profile.indexOf(
		"onSave(): Promise<void>",
		pageImplementationStart,
	);
	const saveEnd = profile.indexOf("\n\t},", saveStart);
	const saveBody = profile.slice(saveStart, saveEnd);
	const updateIndex = saveBody.indexOf("updateUserProfile({");

	// 页面层的前置判断必须发生在 PUT 之前：加载失败、未加载完成或重复点击
	// 都不能把默认值/旧 version 送到服务端，再依赖 409 兜底。
	expect(
		saveBody.indexOf("if (this.data.saving || this.data.navigationPending)"),
	).toBeLessThan(updateIndex);
	expect(
		saveBody.indexOf(
			"if (!isCurrentSessionGeneration(profileSessionGeneration))",
		),
	).toBeLessThan(updateIndex);
	expect(saveBody.indexOf("if (this.data.loading)")).toBeLessThan(updateIndex);
	expect(saveBody.indexOf("if (!this.data.loaded)")).toBeLessThan(updateIndex);
	expect(saveBody).toContain("if (!saveGuard.isCurrent(saveToken)) return;");

	// 只有服务端返回完整 canonical 快照后才显示保存成功；请求异常统一进入
	// showError，409 由页面中文错误边界提示刷新，不能伪造成功或自动覆盖。
	expect(
		saveBody.indexOf("toProfilePageFields(response.data)"),
	).toBeGreaterThan(updateIndex);
	expect(profile).toContain("服务端 canonical 快照");
	expect(saveBody).toContain('this.showError(error, "个人资料保存失败")');
	expect(profile).toContain("个人资料已被其他设备修改，请下拉刷新后重试");
	// 409 后不能继续用旧 version 重复提交；页面必须隐藏保存入口，
	// 通过下拉刷新重新取得服务端最新资料后才能再次编辑。
	expect(saveBody).toContain('error.code === "user-profile-conflict"');
	expect(saveBody).toContain("loaded: false");
	expect(profileTemplate).toContain('wx:if="{{loaded}}" class="save-button"');
});

test("native profile picker keeps its range and bounded index initialized", async () => {
	const profile = await source("pages/profile/profile.ts");
	const profileTemplate = await source("pages/profile/profile.wxml");

	// 开发者工具曾经出现过控制/渲染层的 `undefined is not iterable`，但这类
	// 日志不能直接证明业务代码有错。这里至少把最容易造成同类问题的页面
	// 前置条件固化：range 必须在首帧已有三项，索引必须有安全默认值，事件
	// 只能写入固定枚举。真机仍需继续验证工具和渲染层本身的行为。
	expect(profile).toContain("genderLabels: GENDER_LABELS");
	expect(profile).toContain("genderIndex: 2");
	expect(profile).toContain(
		'const GENDER_VALUES = ["male", "female", "unknown"]',
	);
	expect(profile).toContain("Number.isInteger(rawIndex)");
	expect(profileTemplate).toContain('range="{{genderLabels}}"');
	expect(profileTemplate).toContain('value="{{genderIndex}}"');
	expect(profileTemplate).toContain('bindchange="onGenderChange"');
});

test("native mini program build guards the DevTools TypeScript configuration", async () => {
	const config = JSON.parse(await source("../project.config.json")) as {
		miniprogramRoot?: string;
		setting?: {
			useCompilerPlugins?: unknown;
		};
	};
	const buildConfig = JSON.parse(await source("../tsconfig.build.json")) as {
		exclude?: unknown;
	};
	const build = await Bun.file(
		join(import.meta.dir, "..", "scripts", "build.ts"),
	).text();
	const turboConfig = JSON.parse(
		await Bun.file(join(import.meta.dir, "..", "turbo.json")).text(),
	) as { extends?: unknown; tasks?: { build?: { cache?: unknown } } };

	// project.config.json 是开发者工具配置，空格、换行和 CRLF 都不属于
	// 业务语义；解析 JSON 后校验字段，避免用户合法的格式化差异让门禁误报。
	expect(config.miniprogramRoot).toBe("dist/");
	expect(config.setting?.useCompilerPlugins).toEqual(["typescript"]);
	// 测试文件必须留在源码验证链路中，但不能被 tsc 发到微信运行包；
	// test/spec 两种常见命名都必须和运行包的文件级门禁保持一致。
	expect(buildConfig.exclude).toEqual(["src/**/*.test.ts", "src/**/*.spec.ts"]);
	expect(build).toContain("tsconfig.build.json");
	expect(build).toContain("appPagePaths");
	expect(build).toContain("app.json page scripts are present");
	expect(build).toContain("report-directory/report-directory.js");
	// 爽约页虽然也由 app.json 动态校验，但必须同时出现在重点静态/脚本清单中，
	// 防止后续维护只更新页面注册而漏掉运行包门禁。
	expect(build).toContain("missed-appointments/missed-appointments.wxss");
	expect(build).toContain("missed-appointments/missed-appointments.ts");
	expect(build).toContain("project.private.config.json");
	expect(build).toContain("ignoreDevUnusedFiles");
	// 仓库只能有一个微信项目入口。src/ 下的嵌套配置会让开发者工具同时
	// 监听源码和 dist，旧的增量页面图就可能把已删除的页面或 *.js 带回来。
	expect(build).toContain("nestedSourceProjectConfigPath");
	expect(build).toContain("Bun.file(nestedSourceProjectConfigPath).exists()");
	expect(build).toContain("must be removed");
	expect(build).toContain("only DevTools project root");
	expect(build).toContain("src 仍是唯一业务源码");
	expect(build).toContain("runtime must not contain test scripts");
	expect(build).toContain("build-info.json");
	expect(build).toContain("sourceRevision");
	expect(build).toContain("buildRevisionPlaceholder");
	expect(await source("app.ts")).toContain("MINI_PROGRAM_BUILD_REVISION");
	// build-info.json 写入 Git 来源指纹；如果 Turbo 复用提交前的缓存产物，
	// 开发者工具可能打开旧页面。小程序构建因此必须关闭缓存，不能只依赖
	// 源文件内容命中来推断来源提交已经同步。
	expect(turboConfig.extends).toEqual(["//"]);
	expect(turboConfig.tasks?.build?.cache).toBe(false);
});

test("native mini program app entry remains a global script", async () => {
	const app = await Bun.file(
		join(import.meta.dir, "..", "src", "app.ts"),
	).text();
	const build = await Bun.file(join(import.meta.dir, "build.ts")).text();

	// App 入口由微信直接执行，源码可以依赖资料仓库，但构建必须把它打包成
	// 没有 CommonJS 启动壳的全局 IIFE。
	expect(app).not.toMatch(/export\s+type\s+AppGlobalData/);
	expect(build).toContain(
		"app.js must remain a global script without CommonJS bootstrap",
	);
	expect(build).toContain("Bun.build");
	expect(build).toContain('format: "iife"');
	expect(build).toContain("app.ts global-script bundle failed");
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
	expect(build).toContain("registerClinicalSurfacePage(");
	expect(build).toContain("clinical-entry-surface.ts");
});

test("native mini program runtime verification checks build provenance", async () => {
	const build = await Bun.file(
		join(import.meta.dir, "..", "scripts", "build.ts"),
	).text();
	const verify = await Bun.file(
		join(import.meta.dir, "..", "scripts", "verify-runtime.ts"),
	).text();
	const provenance = await Bun.file(
		join(import.meta.dir, "..", "scripts", "runtime-provenance.ts"),
	).text();

	// dist/ 可能被开发者工具持续监听；来源指纹必须先写入 staging 目录，
	// 再一次性发布到 live 目录，避免 tsc 编译期间出现“目录存在但页面 JS 暂时不存在”的 404。
	expect(build).toContain('join(stagingRuntime, "build-info.json")');
	expect(build).toContain(
		'join(dirname(root), ".hospital-miniprogram-staging-")',
	);
	expect(build).toContain("--outDir");
	expect(build).toContain("publishMiniProgramRuntime(stagingRuntime, runtime)");
	expect(build).not.toContain(
		"await rm(runtime, { recursive: true, force: true })",
	);
	expect(build).toContain("generatedAt");
	expect(verify).toContain('assertFile("build-info.json")');
	expect(verify).toContain("runtime must not contain test scripts");
	expect(verify).toContain("buildInfo.pageCount");
	expect(verify).toContain(
		'for (const extension of [".js", ".json", ".wxml", ".wxss"] as const)',
	);
	expect(verify).toContain("appConfig.pages as string[]");
	expect(verify).toContain("sourceRevision");
	expect(verify).toContain("HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION");
	expect(verify).toContain("build provenance mismatch");
	expect(provenance).toContain('"apps/miniprogram/src"');
	expect(provenance).toContain('"apps/miniprogram/scripts/build.ts"');
	expect(provenance).toContain(
		'"apps/miniprogram/scripts/runtime-provenance.ts"',
	);
	expect(provenance).toContain(
		'"apps/miniprogram/scripts/runtime-publisher.ts"',
	);
	expect(provenance).toContain('"apps/miniprogram/turbo.json"');
	expect(provenance).toContain('"git",\n\t\t\t"status"');
	expect(provenance).toContain(
		"Mini program runtime inputs are dirty; commit them before build or runtime verification",
	);
	// project.config.json 由开发者工具维护，必要字段会在 build.ts 单独校验，
	// 不能因为本地工具格式化或额外设置变化而伪造一个新的业务源码版本。
	expect(provenance).not.toContain('"apps/miniprogram/project.config.json"');
	expect(provenance).not.toContain('"apps/miniprogram/scripts"');
	expect(provenance).toContain('"packages/contracts/src"');
	expect(provenance).not.toContain('"docs"');
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
	const recordsStyle = await source(
		"pages/appointment-records/appointment-records.wxss",
	);

	expect(app).toContain('"pages/appointment-directory/appointment-directory"');
	expect(app).toContain('"pages/appointment-records/appointment-records"');
	expect(home).toContain("navigateToAuthenticatedPage");
	expect(home).toContain('"/pages/hospital-list/hospital-list"');
	expect(home).toContain("navigateToPatientScopedPage");
	expect(home).toContain('"/pages/appointment-records/appointment-records"');
	expect(home).not.toContain("预约下单功能仍在迁移中");
	expect(directory).toContain("loadAppointmentDepartments");
	expect(directory).toContain("loadDepartmentSchedules");
	expect(directory).toContain("scheduleGuard");
	expect(directory).toContain("directoryGuard");
	expect(directory).toContain("directoryScheduleToken");
	expect(directory).toContain(
		"scheduleGuard.isCurrent(directoryScheduleToken)",
	);
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
	// 完整预约历史仍保留在页面状态；只有可见窗口交给 WXML，不能把本地分批
	// 描述成 provider 分页，也不能因为首批少就把 total/状态事实截断。
	expect(records).toContain("APPOINTMENT_RECORD_PAGE_SIZE");
	expect(records).toContain("getVisibleRecords");
	expect(records).toContain("visibleRecords: filteredRecords.slice");
	expect(records).toContain("onLoadMore(): void");
	expect(recordsTemplate).toContain('wx:key="viewKey"');
	expect(recordsTemplate).toContain("visibleRecords");
	expect(recordsTemplate).toContain("加载更多挂号记录");
	expect(records).toContain("loadCurrentPatient");
	expect(directoryTemplate).toContain("未来 7 天");
	expect(directoryTemplate).toContain("cascade-shell");
	expect(directoryTemplate).toContain("加载更多号源");
	expect(directoryTemplate).toContain("当前暂无可预约科室");
	expect(directoryTemplate).toContain("预约下单、锁号、取消和支付");
	expect(recordsTemplate).toContain('bindtap="onChangePatient"');
	// 错误态的换人按钮不能成为所有失败的默认出口：只有患者上下文明确
	// 缺失/失效时才显示，Provider、网络、持久化和依赖配置失败只允许重试。
	expect(records).toContain("canSelectPatient: false");
	expect(records).toContain(
		"const canSelectPatient = isPatientSelectionError(error)",
	);
	expect(recordsTemplate).toContain('wx:if="{{canSelectPatient}}"');
	expect(recordsTemplate).toContain('bindtap="onRetry"');
	// 旧端挂号页使用 default layout；固定四项底栏只属于首页和“我的”页。
	expect(recordsTemplate).not.toContain('wx:for="{{tabBarItems}}"');
	expect(recordsTemplate).not.toContain('bindtap="onTabBarTap"');
	expect(records).not.toContain("LEGACY_TAB_BAR_ITEMS");
	// 卡片详情还没有稳定公开引用时，点击必须给出明确的迁移状态，
	// 不能把列表索引误当成预约详情或取消/支付业务主键。
	expect(recordsTemplate).toContain('bindtap="onRecordTap"');
	expect(recordsTemplate).toContain('data-view-key="{{item.viewKey}}"');
	expect(recordsTemplate).not.toContain('data-index="{{index}}"');
	expect(records).toContain("findVisibleRecord");
	expect(records).toContain("requestToken),");
	expect(records).toContain('navigateToFeatureStatus("appointment-detail")');
	// 我的挂号必须保留旧端的患者/院区选择区、状态标签和卡片操作位置。
	expect(recordsTemplate).toContain("当前院区");
	// 旧端院区行有右侧箭头和底部选择面板；新端只展示一个受控院区，
	// 因此保留视觉和单项交互，但不能把未知院区列表伪造出来。
	expect(recordsTemplate).toContain('bindtap="onHospitalTap"');
	expect(recordsTemplate).toContain(
		"/assets/legacy-user/selector-arrow-right.svg",
	);
	expect(recordsTemplate).toContain("showHospitalModal");
	expect(records).toContain("onHospitalSelect");
	expect(records).toContain("当前只有一个已经确认的院区");
	expect(recordsTemplate).toContain("在线挂号");
	expect(recordsTemplate).toContain("全部挂号");
	expect(recordsTemplate).toContain("预问诊");
	expect(recordsTemplate).toContain("院内导航");
	expect(recordsTemplate).toContain('class="selector-name"');
	// 旧端患者行是“姓名（编号）”的紧凑视觉结构；编号在原生端必须仍是
	// 平台脱敏卡号，避免为追求视觉一致而把 Provider 患者号重新带回小程序。
	expect(recordsTemplate).toContain(
		'class="selector-card-number">（{{selectedPatient.cardNumberMasked}}）</text>',
	);
	expect(recordsTemplate).toContain('class="location-close"');
	expect(recordsTemplate).toContain('bindtap="closeLocationModal"');
	expect(recordsTemplate).toContain("/assets/legacy-user/location-close.svg");
	expect(recordsTemplate).toContain("/assets/legacy-user/location-search.svg");
	expect(recordsTemplate).not.toContain('class="selector-arrow"');
	// 旧端挂号页是全宽 selector/tabs/list，不能回退成新端 710rpx 居中卡片。
	expect(recordsStyle).toContain("width: 100%;");
	expect(recordsStyle).toContain("background: #f5f5f5;");
	expect(recordsStyle).toContain("padding: 32rpx 32rpx 160rpx;");
	expect(recordsStyle).toContain("min-height: 380rpx;");
	expect(recordsStyle).toContain("padding: 40rpx 32rpx;");
	expect(recordsStyle).not.toContain("legacy-tabbar");
	// 旧端 py-4 的标签高度和 pb-20 的底部节奏必须固定，避免页面视觉逐步漂移。
	expect(recordsStyle).toContain("height: 112rpx;");
	expect(recordsStyle).toContain(
		"transition: background-color 0.2s ease, transform 0.2s ease;",
	);
	expect(recordsStyle).toContain("transform: scale(0.99);");
	expect(recordsTemplate).toContain(
		"/assets/legacy-user/appointment-status.svg",
	);
	expect(recordsTemplate).toContain("/assets/legacy-user/empty-record.svg");
	expect(recordsTemplate).not.toContain(
		"/assets/legacy-home/empty-services.png",
	);
	expect(records).toContain("filterAppointmentRecords");
	expect(records).toContain('navigateToFeatureStatus("pre-visit")');
	// 预约写入、provider 患者标识和支付字段均不得进入小程序页面。
	expect(directory).not.toContain("providerPatientId");
	expect(records).not.toContain("providerPatientId");
	expect(records).not.toContain("wx.requestPayment");
});

test("native appointment record actions reject stale index events", async () => {
	const records = await source(
		"pages/appointment-records/appointment-records.ts",
	);
	const template = await source(
		"pages/appointment-records/appointment-records.wxml",
	);
	const view = await source("services/appointment-record-view.ts");

	// 预约卡片事件必须用当前渲染批次的视图 key 回查；索引在患者切换后
	// 仍可能是合法数字，但它已经不再代表原来的预约记录。
	expect(records).toContain("findVisibleRecord");
	expect(records).toContain("event.currentTarget?.dataset?.viewKey");
	expect(records).toContain("renderGeneration: number");
	expect(view).toMatch(
		/viewKey: `\$\{prefix\}-\$\{renderGeneration\}-\$\{index\}`/,
	);
	expect(template).toContain('data-view-key="{{item.viewKey}}"');
	expect(template).not.toContain('data-index="{{index}}"');
});

test("native appointment tabs use server-owned read scopes", async () => {
	const records = await source(
		"pages/appointment-records/appointment-records.ts",
	);
	const template = await source(
		"pages/appointment-records/appointment-records.wxml",
	);
	const view = await source("services/appointment-record-view.ts");
	const client = await source("services/api-client.ts");

	// 页面不接触 Provider 数字渠道；切换到全部标签时只发送业务范围，
	// 由服务端选择已确认的渠道 4，避免把在线结果本地复制成全部结果。
	expect(records).toContain("filterAppointmentRecords");
	expect(records).toContain("isAppointmentRecordTabAvailable");
	expect(records).toContain("loadRecords(tab?: AppointmentRecordTab)");
	expect(records).toContain("const requestedTab = tab ?? this.data.activeTab");
	expect(records).toContain("this.loadRecords(activeTab)");
	expect(records).toContain("requestedTab,");
	expect(view).toContain('record.status !== "cancelled"');
	expect(records).not.toContain("requestChannel");
	// 底层请求必须先经过 canonical union 归一化，再编码最终 scope；
	// 不能只检查“存在 scope”而放过未知范围或日期错配。
	expect(client).toContain("encodeURIComponent(normalized.scope)");
	expect(client).toContain("requireAppointmentRecordRequestOptions");
	expect(client).toContain("scope=");
	expect(template).not.toContain("status-tab-disabled");
});

test("native appointment tab intent survives a stale patient reload", async () => {
	const records = await source(
		"pages/appointment-records/appointment-records.ts",
	);
	const stalePatientStart = records.indexOf(
		"if (this.data.selectedPatient && !this.isPatientContextCurrent())",
	);
	const stalePatientBody = records.slice(
		stalePatientStart,
		stalePatientStart + 520,
	);

	// 患者代际失效时，重建 `/me` → 患者目录 → 记录查询链路不能丢掉用户
	// 刚点击的标签意图；否则页面标签和服务端查询范围会暂时不一致。
	expect(stalePatientBody).toContain("this.setData({ activeTab });");
	expect(stalePatientBody).toContain("void this.loadRecords(activeTab);");
});

test("outpatient payment tabs cannot cancel the initial patient load", async () => {
	const payment = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);
	const statusStart = payment.indexOf("onStatusTap(event)");
	const statusEnd = payment.indexOf("\n\t},", statusStart);
	const statusBody = payment.slice(statusStart, statusEnd);
	const patientGuardIndex = statusBody.indexOf(
		"if (!this.data.selectedPatient)",
	);
	const requestGuardIndex = statusBody.indexOf(
		'getPageLatestRequestGuard(this, "outpatient-payment")',
	);

	// 初始 loadPage 尚未拿到患者时，切换 tab 只能记录意图，不能先创建
	// 新 guard 再把 owner-scoped 患者目录请求判为过期。
	expect(patientGuardIndex).toBeGreaterThanOrEqual(0);
	expect(requestGuardIndex).toBeGreaterThan(patientGuardIndex);
	expect(statusBody).toContain("...(this.data.loading");
	expect(statusBody).toContain("canSelectPatient: true");
	expect(statusBody).toContain("请先登录并选择就诊人");
});

test("outpatient payment tab failures refresh the session entry state", async () => {
	const payment = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);
	const statusStart = payment.indexOf("onStatusTap(event)");
	const statusEnd = payment.indexOf("\n\t},", statusStart);
	const statusBody = payment.slice(statusStart, statusEnd);
	const errorStateIndex = statusBody.indexOf(
		"sessionState: sessionStateAfterAuthenticatedReadError(",
	);
	const errorClearIndex = statusBody.indexOf(
		'this.showError(error, "门诊缴费记录加载失败")',
	);

	// 待缴/已缴 tab 是独立的患者范围请求；它收到 401 或依赖故障时，
	// 不能只清空费用卡片而保留旧的 valid。否则下一次“更换就诊人”
	// 会错误进入选择页，而不是按最新会话事实等待或回登录页。
	expect(errorStateIndex).toBeGreaterThanOrEqual(0);
	expect(errorClearIndex).toBeGreaterThan(errorStateIndex);
});

test("outpatient payment tabs revalidate the patient session before querying", async () => {
	const payment = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);
	const statusStart = payment.indexOf("onStatusTap(event)");
	const statusEnd = payment.indexOf("\n\t},", statusStart);
	const statusBody = payment.slice(statusStart, statusEnd);
	const recordsStart = payment.indexOf("async loadRecords(");
	const recordsEnd = payment.indexOf("\n\t},", recordsStart);
	const recordsBody = payment.slice(recordsStart, recordsEnd);

	// 页面卡片可能在另一个页面换号后仍短暂存在；状态切换必须先回到
	// `/me` + 患者目录组合读取，不能把旧患者对象直接发送给费用 API。
	expect(statusBody).toContain(
		"this.data.patientSessionGeneration !== getSessionGeneration()",
	);
	expect(statusBody).toContain("!isCurrentSelectedPatient(selectedPatient.id)");
	expect(statusBody).toContain("void this.loadPage()");
	expect(statusBody).toContain("this.data.patientSessionGeneration,");
	// 即使未来新增其它 loadRecords 调用方，也必须在网络请求前做代际断言。
	expect(recordsBody).toContain(
		"Outpatient payment page session changed before records were requested",
	);
});

test("outpatient payment cards reject stale status events", async () => {
	const payment = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);
	const template = await source(
		"pages/outpatient-payment/outpatient-payment.wxml",
	);

	// 费用页面当前不开放支付，但旧卡片事件仍不能只凭 dataset.status
	// 继续被消费。必须先确认当前患者/会话，再用本次查询批次的 viewKey
	// 回查记录，避免换号后把旧卡片当成新患者的费用状态。
	expect(payment).toContain("findVisiblePayment");
	expect(payment).toContain("isPatientContextCurrent()");
	expect(payment).toContain("event.currentTarget?.dataset?.viewKey");
	expect(payment).toMatch(
		/viewKey: `outpatient-payment-\$\{renderGeneration\}-\$\{index\}`/,
	);
	expect(template).toContain('data-view-key="{{item.viewKey}}"');
	expect(template).not.toContain('data-status="{{item.status}}"');
});

test("outpatient payment preserves the legacy patient and hospital selector rows", async () => {
	const payment = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);
	const template = await source(
		"pages/outpatient-payment/outpatient-payment.wxml",
	);
	const style = await source(
		"pages/outpatient-payment/outpatient-payment.wxss",
	);

	// 这是展示/入口迁移，不是院区业务扩展：患者仍进入独立选择页，
	// 单院区点击只提示，不把未知院区 ID 或 Provider 参数交给费用查询。
	expect(payment).toContain('const DEFAULT_HOSPITAL_NAME = "高平市人民医院"');
	expect(payment).toContain("onHospitalTap(): void");
	expect(payment).toContain("当前仅支持高平市人民医院");
	expect(template).toContain('class="selector-card"');
	expect(template).toContain('bindtap="onChangePatient"');
	expect(template).toContain('bindtap="onHospitalTap"');
	expect(template).toContain(
		'src="/assets/legacy-user/selector-arrow-right.svg"',
	);
	expect(style).toContain(".selector-row");
	expect(style).toContain(".selector-card-number");
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
	expect(home).toContain("navigateToAuthenticatedPage");
	expect(home).toContain('"/pages/hospital-list/hospital-list"');
	// 旧首页顶部“互联网医院”实际指向 pagesB/hospital/hospitalList，
	// 不能因为标签名称而误判为必须恢复外部 web-view。
	expect(home).toContain('action: "hospital-list"');
	expect(home).toContain('case "hospital-list"');
	expect(page).toContain("STATIC_HOSPITAL");
	expect(page).toContain(
		'url: "/pages/appointment-directory/appointment-directory"',
	);
	// 医院列表可能被深链直接打开；点击预约前仍必须验证平台会话，
	// 不能让预约目录先发起一个必然得到 401 的请求。
	expect(page).toContain("restorePlatformSession");
	expect(page).toContain("sessionVerificationStateFromError");
	expect(page).toContain("registerLoading");
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

test("native mini program migrates the legacy agreement as read-only text", async () => {
	const app = await source("app.json");
	const catalog = await source("services/legacy-page-catalog.ts");
	const page = await source("pages/patient-agreement/patient-agreement.ts");
	const template = await source(
		"pages/patient-agreement/patient-agreement.wxml",
	);
	const style = await source("pages/patient-agreement/patient-agreement.wxss");
	const navigation = await source("services/feature-navigation.ts");
	const contractSurface = await source("services/patient-contract-surface.ts");

	expect(app).toContain('"pages/patient-agreement/patient-agreement"');
	expect(catalog).toContain('legacyPath: "pagesB/patient/agreement.vue"');
	expect(catalog).toContain('status: "replaced"');
	expect(catalog).toContain(
		'nativeTarget: "pages/patient-agreement/patient-agreement"',
	);
	expect(page).toContain("只展示旧端已存在的静态条款文本");
	expect(page).toContain("不记录同意状态");
	expect(template).toContain("使用条款和隐私政策");
	expect(template).toContain("一、总则");
	expect(template).toContain("十一、其他条款");
	expect(template).toContain('scroll-y="true"');
	expect(style).toContain(".policy-scroll");
	expect(style).toContain(".chapter-title");
	// 绑定/签名页面只能跳转到静态原文，不能把查看协议当作同意授权。
	expect(navigation).toContain(
		'"patient-agreement": "/pages/patient-agreement/patient-agreement"',
	);
	expect(contractSurface).toContain("onOpenPatientAgreement");
	// 旧端协议没有可靠的版本和同意记录契约，静态页不能伪造提交动作。
	expect(page).not.toContain("agreementVersion");
	expect(page).not.toContain("handleAccept");
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
	expect(page).toContain('title: "跳转到意见反馈页面"');
	expect(page).toContain("wx.showToast");
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
	expect(feedback).toContain('title: "跳转到意见反馈页面"');
	expect(feedback).toContain("wx.showToast");
	expect(feedback).not.toContain("提交成功");
	expect(feedback).not.toContain("设置已保存");
	expect(officialAccount).toContain("只维护静态展示");
	expect(officialAccount).not.toContain("requestSubscribeMessage");
	expect(app).not.toContain("subscription-message");
});

test("native mini program migrates the legacy express placeholder without fake logistics", async () => {
	const catalog = await source("services/legacy-page-catalog.ts");
	const page = await source("pages/patient-express/patient-express.ts");
	const template = await source("pages/patient-express/patient-express.wxml");
	const style = await source("pages/patient-express/patient-express.wxss");

	// 旧端 express.vue 没有物流请求，预留列表始终为空；这里迁移的是
	// 已存在的患者栏和空态，不把“页面能打开”误写成物流服务已接通。
	expect(catalog).toContain('status: "partial"');
	expect(catalog).toContain("旧端实际只有患者选择和预留空列表");
	expect(page).toContain("loadCurrentPatient");
	expect(page).toContain('navigateToFeatureStatus("patient-express")');
	expect(template).toContain("未查询到相关记录!");
	expect(template).toContain("选择就诊人");
	expect(template).toContain("旧端当前没有接入物流记录服务");
	expect(template).toContain("/assets/legacy-user/empty-record.svg");
	expect(style).toContain(".patient-express-empty");
	expect(page).not.toContain("providerPatientId");
});

test("native blood appointment keeps the legacy empty state without fake slots", async () => {
	const catalog = await source("services/legacy-page-catalog.ts");
	const page = await source("pages/blood-appointment/blood-appointment.ts");
	const template = await source(
		"pages/blood-appointment/blood-appointment.wxml",
	);
	const style = await source("pages/blood-appointment/blood-appointment.wxss");

	// 旧端采血页没有号源请求，患者和院区都是硬编码；迁移时只能保留真实
	// 空态和可解释的患者切换，不能把普通门诊号源或硬编码患者冒充采血业务。
	expect(catalog).toContain('featureKey: "blood-appointment"');
	expect(page).toContain("loadCurrentPatient");
	expect(page).toContain('navigateToFeatureStatus("blood-appointment")');
	expect(page).toContain("不复用普通门诊号源");
	expect(page).not.toContain("hasProjects");
	expect(page).not.toContain("providerPatientId");
	expect(template).toContain("无可预约项目！");
	expect(template).toContain("院区信息待采血服务接入");
	expect(template).toContain("选择就诊人");
	expect(template).toContain("/assets/legacy-home/empty-services.png");
	expect(style).toContain(".blood-appointment-empty-card");
	expect(style).toContain(".blood-appointment-error");
});

test("native convenience pages keep patient context without fake public records", async () => {
	const service = await source("services/convenience-surface.ts");
	const gift = await source("pages/gift-banner/gift-banner.wxml");
	const praise = await source("pages/health-praise/health-praise.wxml");
	const giftScript = await source("pages/gift-banner/gift-banner.ts");
	const praiseScript = await source("pages/health-praise/health-praise.ts");

	// 锦旗和表扬信都要先绑定当前就诊人，但 provider contract 未确认前，
	// “公开记录暂未开放”不能降级成“暂无记录”，也不能出现提交成功。
	expect(service).toContain("loadCurrentPatient");
	expect(service).toContain("公开记录查询");
	expect(service).toContain("不读取、不提交任何内容");
	expect(service).toContain("disposePageInstance");
	expect(service).toContain("convenienceSurfaceErrorMessage");
	expect(service).toContain("patientScopedErrorMessage");
	expect(gift).toContain("选择就诊人");
	expect(praise).toContain("选择就诊人");
	expect(gift).toContain("recordState === 'loading'");
	expect(praise).toContain("recordState === 'loading'");
	expect(gift).toContain("暂时无法展示记录");
	expect(praise).toContain("暂时无法展示记录");
	expect(gift).toContain("公开记录暂未开放");
	expect(praise).toContain("公开记录暂未开放");
	expect(giftScript).toContain('registerConvenienceSurfacePage("gift-banner")');
	expect(praiseScript).toContain(
		'registerConvenienceSurfacePage("health-praise")',
	);
	expect(service).not.toContain("submitGift");
	expect(service).not.toContain("createCommendatoryLetter");
});

test("direct patient directory pages share one error translation boundary", async () => {
	const pagePaths = [
		"pages/blood-appointment/blood-appointment.ts",
		"pages/patient-express/patient-express.ts",
		"pages/patient-signature/patient-signature.ts",
		"pages/patient-subscription/patient-subscription.ts",
	];
	for (const pagePath of pagePaths) {
		const page = await source(pagePath);
		// 这些页面读取的是同一个 owner-scoped 患者目录；错误文案必须复用
		// 统一边界，不能各自漏掉 stale、临床映射或持久化故障。
		expect(page).toContain("patientScopedErrorMessage");
		expect(page).not.toContain("function errorMessage");
	}
});

test("native blocked domains keep one explicit current-patient context", async () => {
	const context = await source("services/patient-surface-context.ts");
	const factorySources = await Promise.all(
		[
			"services/clinical-entry-surface.ts",
			"services/clinical-content-surface.ts",
			"services/provider-entry-surface.ts",
		].map((file) => source(file)),
	);
	const templates = await Promise.all(
		[
			"pages/admission-preconsultation/admission-preconsultation.wxml",
			"pages/appointment-detail/appointment-detail.wxml",
		].map((file) => source(file)),
	);

	// 这些页面都还没有正式 Provider/临床 contract，但用户从选择页返回后
	// 必须能看到当前上下文、失败原因和重试入口；不能只有一个“选择就诊人”
	// 按钮，却让用户无法判断后续业务究竟针对谁。
	expect(context).toContain("loadCurrentPatient");
	expect(context).toContain("loadCurrentPatientForOwner");
	expect(context).toContain("registerSessionChangedListener");
	expect(context).toContain("patientSurfaceSessionReset");
	expect(context).toContain("assertSessionGeneration");
	expect(context).toContain("patient-selection-required");
	expect(context).toContain("patient-clinical-unavailable");
	expect(context).toContain("disposePageInstance");
	expect(context).toContain("不调用同步 Provider");
	for (const factory of factorySources) {
		expect(factory).toContain("loadPatientSurfaceContext");
		expect(factory).toContain("patientContextLoaded");
		expect(factory).toContain("onRetry");
		expect(factory).toContain("onUnload");
	}
	for (const template of templates) {
		expect(template).toContain("当前就诊人");
		expect(template).toContain("currentPatientName");
		expect(template).toContain('bindtap="onRetry"');
		expect(template).toContain('bindtap="onOpenPatientSelector"');
	}
});

test("我的问诊和门诊病历使用真实原生只读页面，不再渲染等待接入外壳", async () => {
	const consultation = await source("pages/consultation/consultation.ts");
	const consultationTemplate = await source(
		"pages/consultation/consultation.wxml",
	);
	const medicalRecord = await source("pages/medical-record/medical-record.ts");
	const medicalRecordTemplate = await source(
		"pages/medical-record/medical-record.wxml",
	);

	expect(consultation).toContain("loadConsultationHistoryRecords");
	expect(consultation).toContain("visibleRecords");
	expect(consultation).not.toContain("registerExternalEntrySurfacePage");
	expect(consultationTemplate).toContain("号源");
	expect(consultationTemplate).toContain('bindtap="onChangePatient"');

	expect(medicalRecord).toContain("loadOutpatientMedicalRecords");
	expect(medicalRecord).toContain("visibleRecords");
	expect(medicalRecord).not.toContain("registerClinicalSurfacePage");
	expect(medicalRecordTemplate).toContain("诊断结果：");
	expect(medicalRecordTemplate).toContain("未查询到您的记录");
	expect(medicalRecordTemplate).not.toContain("等待业务接入");
});

test("native patient signature keeps the patient boundary without fake external launch", async () => {
	const page = await source("pages/patient-signature/patient-signature.ts");
	const template = await source(
		"pages/patient-signature/patient-signature.wxml",
	);
	const style = await source("pages/patient-signature/patient-signature.wxss");
	const catalog = await source("services/legacy-page-catalog.ts");

	// 旧端使用本地示例患者并把患者 ID 透传给固定外部 AppID；新端只能消费
	// owner-scoped 脱敏目录，签名 contract 未完成前不能伪造跳转或成功。
	expect(catalog).toContain('featureKey: "patient-signature"');
	expect(page).toContain("loadPatients");
	expect(page).toContain("getSelectedPatientId");
	expect(page).toContain('navigateToFeatureStatus("patient-signature")');
	expect(page).not.toContain("navigateToMiniProgram");
	expect(page).not.toContain("wx0b76c9904392518f");
	expect(template).toContain("选择其他就诊人");
	expect(template).toContain("当前不会上传文件");
	expect(template).toContain("电子就诊卡（脱敏）");
	expect(style).toContain(".signature-error");
	expect(style).toContain(".signature-state-card");
});

test("native subscription page preserves legacy presentation but never claims WeChat authorization", async () => {
	const page = await source(
		"pages/patient-subscription/patient-subscription.ts",
	);
	const template = await source(
		"pages/patient-subscription/patient-subscription.wxml",
	);
	const style = await source(
		"pages/patient-subscription/patient-subscription.wxss",
	);
	const catalog = await source("services/legacy-page-catalog.ts");

	// 旧端的“确定修改”没有服务端保存或微信授权调用；本页只迁移搜索、分类、
	// 折叠和患者上下文，所有开关关闭并明确展示“暂未接入”。
	expect(catalog).toContain('featureKey: "patient-subscription"');
	expect(page).toContain("loadCurrentPatient");
	expect(page).toContain("buildSections");
	// 分类折叠的 dataset 是不可信的运行时边界；必须只接受枚举自身的 key，
	// 不能用会穿透原型链的 `in`，避免后续模板复用引入异常分类。
	expect(page).toContain("Object.hasOwn(CATEGORY_TITLES, sectionKey)");
	expect(page).not.toContain("sectionKey in CATEGORY_TITLES");
	expect(page).toContain('navigateToFeatureStatus("patient-subscription")');
	expect(page).not.toContain("requestSubscribeMessage");
	expect(page).not.toContain("设置已保存");
	expect(template).toContain("请输入消息标题进行查询");
	expect(template).toContain("暂未接入");
	expect(template).toContain("查看完整迁移说明");
	expect(style).toContain("position: fixed");
	expect(style).toContain(".subscription-result-state");
});

test("native mini program derives missed appointments from the normalized record status", async () => {
	const app = await source("app.json");
	const my = await source("pages/my/my.ts");
	const myTemplate = await source("pages/my/my.wxml");
	const page = await source("pages/missed-appointments/missed-appointments.ts");
	const navigation = await source("services/patient-navigation.ts");
	const template = await source(
		"pages/missed-appointments/missed-appointments.wxml",
	);
	const style = await source(
		"pages/missed-appointments/missed-appointments.wxss",
	);

	expect(app).toContain('"pages/missed-appointments/missed-appointments"');
	expect(my).toContain('case "missed-appointments"');
	// 爽约记录不自动打开患者选择模块；URL 仍必须保留在页面源中，防止
	// 静态迁移时只保留菜单 action 却丢失真实页面目标。
	expect(my).toContain("navigateToMissedAppointmentsPage");
	expect(navigation).toContain(
		'"/pages/missed-appointments/missed-appointments"',
	);
	expect(myTemplate).toContain('data-action="{{item.action}}"');
	expect(my).toContain('action: "missed-appointments"');
	expect(page).toContain("loadAppointmentRecords");
	// 爽约判定集中在展示服务，避免页面重新解释 provider 状态码；这里检查
	// 页面确实使用该服务，而不是绑定某一种实现写法。
	expect(page).toContain("isMissedAppointment");
	expect(page).toContain("MISSED_APPOINTMENT_PAGE_SIZE");
	expect(page).toContain("visibleRecords: missedRecords.slice");
	expect(page).toContain("onLoadMore(): void");
	expect(template).toContain('wx:key="viewKey"');
	expect(template).toContain("visibleRecords");
	expect(template).toContain("加载更多爽约记录");
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
	// 患者上下文错误留在本页可重试错误态，爽约空态只代表当前已确认患者
	// 确实没有 missed 记录，不能把“选择就诊人”当作查询结果。
	expect(template).not.toContain("请先选择就诊人");
	expect(template).not.toContain("点击这里选择就诊人");
	expect(page).not.toContain("redirectToPatientSelector");
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
	const navigation = await source("services/patient-navigation.ts");

	expect(app).toContain('"pages/outpatient-payment/outpatient-payment"');
	expect(app).toContain('"pages/my/my"');
	expect(client).toContain("requestOutpatientPaymentRecords");
	expect(client).toContain("/payments/outpatient/records?");
	expect(home).toContain("navigateToPatientScopedPage");
	expect(home).toContain('"/pages/outpatient-payment/outpatient-payment"');
	expect(app).toContain('"custom": false');
	expect(app).toContain('"position": "bottom"');
	expect(app).toContain(
		'"selectedIconPath": "assets/legacy-home/tab-04-native-active-v6.png"',
	);
	expect(outpatient).toContain("loadOutpatientPaymentRecords");
	// tab 切换必须把用户本次点击的状态和当前患者会话快照传入，不能依赖
	// setData 的异步回写，也不能把上一轮会话的患者对象直接交给 API。
	expect(outpatient).toContain(
		"this.loadRecords(\n\t\t\tselectedPatient,\n\t\t\tstatus,\n\t\t\trequestToken,\n\t\t\tthis.data.patientSessionGeneration,",
	);
	expect(outpatient).toContain(
		"loadOutpatientPaymentRecords(\n\t\t\tpatient.id,\n\t\t\tstatus,\n\t\t\texpectedSessionGeneration,",
	);
	// 服务端仍返回完整只读结果；小程序只分批建立渲染树，不能把这个行为
	// 描述成 provider 分页，也不能因为首批记录少就推导费用已支付。
	expect(outpatient).toContain("OUTPATIENT_PAYMENT_PAGE_SIZE");
	expect(outpatient).toContain("visibleItems: mappedItems.slice");
	expect(outpatient).toContain("onLoadMore(): void");
	expect(outpatientTemplate).toContain("待缴费");
	expect(outpatientTemplate).toContain('data-view-key="{{item.viewKey}}"');
	expect(outpatientTemplate).toContain("visibleItems");
	expect(outpatientTemplate).toContain("加载更多缴费记录");
	expect(outpatientTemplate).toContain("{{item.billDateLabel}}");
	expect(outpatient).toContain("formatOutpatientBillDateLabel");
	expect(outpatientTemplate).toContain(
		"当前仅展示门诊费用查询结果，支付、退费和医保结算请以医院正式渠道为准",
	);
	// 旧端文案会暗示支付或医保已经可以在此页面执行；只读页面必须明确拒绝这种语义回流。
	expect(outpatientTemplate).not.toContain("缴费后如需退费需至窗口办理");
	expect(outpatientTemplate).not.toContain("目前支付宝支持");
	expect(outpatient).toContain("navigateToFeatureStatus");
	expect(outpatient).toContain('"outpatient-payment-detail"');
	expect(outpatient).toContain('"outpatient-payment-write"');
	expect(outpatientTemplate).toContain(
		"支付调起、医保授权和结算回写将在独立业务契约验收后开放",
	);
	expect(my).toContain("navigateToPatientSelector");
	expect(my).toContain("navigateToPatientScopedPage");
	expect(navigation).toContain('url: "/pages/patient-select/patient-select"');
	expect(my).toContain('"/pages/appointment-records/appointment-records"');
	expect(myTemplate).toContain("家庭成员管理");
	expect(myTemplate).not.toContain("legacy-tabbar");
	// 小程序不能把 provider patId、provider 订单号或旧直连地址交给页面。
	expect(outpatient).not.toContain("providerPatientId");
	expect(outpatient).not.toContain("outTradeOrderId");
});

test("patient list load-more events cannot mutate stale read-model windows", async () => {
	const pages = [
		{
			file: "pages/appointment-records/appointment-records.ts",
			more: "!this.data.hasMoreRecords",
		},
		{
			file: "pages/missed-appointments/missed-appointments.ts",
			more: "!this.data.hasMoreRecords",
		},
		{
			file: "pages/report-directory/report-directory.ts",
			more: "!this.data.hasMoreReports",
		},
		{
			file: "pages/outpatient-payment/outpatient-payment.ts",
			more: "!this.data.hasMoreItems",
		},
	] as const;

	for (const item of pages) {
		const page = await source(item.file);
		const start = page.indexOf("onLoadMore(): void {");
		const end = page.indexOf("\n\t},", start);
		const handler = page.slice(start, end);

		// 这些页面的分批展示不是 Provider 分页。旧事件必须在加载中、
		// 没有患者、会话/患者已漂移或已经没有更多记录时失效，且展示数量
		// 必须严格递增，不能通过重复点击把新状态误写回旧读模型。
		expect(handler).toContain(
			"if (this.data.loading || !this.data.selectedPatient)",
		);
		expect(handler).toContain(item.more);
		expect(handler).toContain("Math.min(");
		expect(handler).toContain("if (nextCount <= this.data.visible");
	}
});

test("patient-scoped empty states keep a reachable patient selector", async () => {
	for (const file of [
		"pages/appointment-records/appointment-records.wxml",
		"pages/report-directory/report-directory.wxml",
		"pages/outpatient-payment/outpatient-payment.wxml",
	] as const) {
		const page = await source(file);
		// 失败或 stale 状态会清空 selectedPatient；此时不能只留下依赖患者卡片的
		// “上方更换”文案，必须有一个真正绑定到选择页的可达入口。
		expect(page).toContain('class="state-hint state-hint-action"');
		expect(page).toContain('bindtap="onChangePatient"');
		expect(page).toContain("wx:else");
		expect(page).toContain('wx:if="{{canSelectPatient}}"');
	}
	const appointmentStyle = await source(
		"pages/appointment-records/appointment-records.wxss",
	);
	const reportStyle = await source(
		"pages/report-directory/report-directory.wxss",
	);
	const outpatientStyle = await source(
		"pages/outpatient-payment/outpatient-payment.wxss",
	);
	const outpatientPage = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);
	expect(appointmentStyle).toContain(".state-hint-action");
	expect(reportStyle).toContain(".state-hint-action");
	expect(outpatientStyle).toContain(".state-hint-action");
	// 门诊费用失败时不能保留上一轮患者卡片；否则空态与当前患者事实不成对，
	// 也会让“更换就诊人”入口消失，必须回到可重新选择的状态。
	expect(outpatientPage).toContain("selectedPatient: null");
	expect(outpatientPage).toContain(
		"const canSelectPatient = isPatientSelectionError(error)",
	);
	expect(outpatientPage).toContain("outpatient-payment-patient-not-found");
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
	expect(client).toContain("requireReportListResponse");
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

test("native report detail actions reject stale directory events", async () => {
	const page = await source("pages/report-directory/report-directory.ts");
	const template = await source("pages/report-directory/report-directory.wxml");
	const client = await source("services/api-client.ts");
	const detail = await source("pages/report-detail/report-detail.ts");

	// 报告引用按当前渲染批次回查；患者切换后，刷新前遗留的 WXML 事件
	// 不得直接携带旧 reportId 导航到旧患者的详情页。
	expect(page).toContain("findVisibleReport");
	expect(page).toContain("event.currentTarget?.dataset?.viewKey");
	const reportLookupIndex = page.indexOf("const report = findVisibleReport(");
	const staleEventGuardIndex = page.indexOf(
		"if (!report) {",
		reportLookupIndex,
	);
	const patientContextIndex = page.indexOf(
		"if (!this.isPatientContextCurrent())",
		staleEventGuardIndex,
	);
	const reportReferenceIndex = page.indexOf(
		"const reportId = report.reportId;",
		patientContextIndex,
	);
	// 先确认事件仍属于当前渲染批次，再确认患者上下文，最后才读取
	// 短期详情引用；这样失效事件不会被误导到功能关闭态。
	expect(staleEventGuardIndex).toBeGreaterThan(reportLookupIndex);
	expect(patientContextIndex).toBeGreaterThan(staleEventGuardIndex);
	expect(reportReferenceIndex).toBeGreaterThan(patientContextIndex);
	expect(page).toContain("this.toView(report, index, requestToken)");
	expect(page).toContain("viewKey: `report-");
	expect(template).toContain('wx:key="viewKey"');
	expect(template).toContain('data-view-key="{{item.viewKey}}"');
	expect(template).not.toContain('data-report-id="{{item.reportId}}"');
	expect(client).toContain("requireReportDetailResponse");
	expect(page).toContain("isCurrentSelectedPatient(patientId)");
	expect(page).toContain("当前就诊人已变化，请重新加载");
	expect(detail).not.toContain("items || []");
});

test("native report directory reserves the patient strip during loading", async () => {
	const template = await source("pages/report-directory/report-directory.wxml");
	const style = await source("pages/report-directory/report-directory.wxss");

	// 报告页的患者上下文要等报告目录读模型确认后才能提交；加载期间必须
	// 预留同等高度，但占位块不能绑定更换患者事件或误导成选择模块。
	expect(template).toContain(
		'class="patient-strip patient-strip-loading" aria-hidden="true"',
	);
	expect(template).toContain('wx:elif="{{loading}}"');
	expect(template).not.toContain(
		'class="patient-strip patient-strip-loading" bindtap="onChangePatient"',
	);
	expect(style).toContain(".patient-strip-loading {");
	expect(style).toContain("min-height: 92rpx;");
	expect(style).toContain(".patient-strip-loading-icon {");
});

test("native report detail errors clear the previous clinical read model", async () => {
	const detail = await source("pages/report-detail/report-detail.ts");
	const showErrorStart = detail.indexOf("showError(error: unknown): void");
	const showErrorEnd = detail.indexOf("\n\t},", showErrorStart);
	const showErrorBody = detail.slice(showErrorStart, showErrorEnd);

	// 详情请求失败、引用过期或患者在请求期间发生变化时，错误态不能只
	// 隐藏 WXML；页面实例还必须清空检测项、报告时间和附件标记，防止重试
	// 或页面复用把上一位患者的临床结果当成当前结果。
	expect(showErrorBody).toContain('reportedAt: ""');
	expect(showErrorBody).toContain("items: []");
	expect(showErrorBody).toContain("hasItems: false");
	expect(showErrorBody).toContain("hasAttachment: false");
});

test("native report detail keeps loading, error and empty states at one stable height", async () => {
	const template = await source("pages/report-detail/report-detail.wxml");
	const style = await source("pages/report-detail/report-detail.wxss");

	// 报告详情的合法空结果来自已确认的服务端读模型；它不能因为比加载态
	// 高而把页面内容突然向下推移。错误态也必须复用同一外层容器，保证
	// “请求中 → 无检测项/无云影像 → 错误重试”都保持稳定的视觉占位。
	expect(template).toContain(
		"class=\"report-state-card query-state-shell query-state-shell-column {{error ? 'error-state' : 'loading-state'}}\"",
	);
	expect(style).toContain(".report-state-card {");
	expect(style).toContain("height: 380rpx;");
	expect(style).toContain("min-height: 360rpx;");
	expect(style).toContain(".report-empty,");
	expect(style).toContain(".cloud-empty {");
});

test("native query pages keep loading and empty result shells at one fixed height", async () => {
	const appStyle = await source("app.wxss");
	const pages = [
		"pages/appointment-records/appointment-records",
		"pages/missed-appointments/missed-appointments",
		"pages/outpatient-payment/outpatient-payment",
		"pages/report-directory/report-directory",
		"pages/patient-select/patient-select",
		"pages/profile/profile",
	] as const;

	// 仅靠 min-height 会让空态图片和恢复动作把卡片继续撑高；所有患者
	// 查询页必须使用公共空间类，并在页面样式中保留 380rpx 的兜底高度。
	expect(appStyle).toContain(".query-state-shell {");
	expect(appStyle).toContain("height: 380rpx;");
	for (const pagePath of pages) {
		const template = await source(`${pagePath}.wxml`);
		const style = await source(`${pagePath}.wxss`);
		expect(template).toContain("query-state-shell");
		expect(style).toContain("height: 380rpx;");
	}
});

test("native missed appointments never auto-opens the patient selector", async () => {
	const my = await source("pages/my/my.ts");
	const missed = await source(
		"pages/missed-appointments/missed-appointments.ts",
	);
	const template = await source(
		"pages/missed-appointments/missed-appointments.wxml",
	);

	// “我的”页点击爽约记录时直接进入本页；只有已有患者卡片上的主动
	// 更换动作才可以调用统一患者选择导航，避免入口意外展示选择模块。
	const actionStart = my.indexOf('case "missed-appointments"');
	const actionEnd = my.indexOf("\n\t\t\t\tbreak;", actionStart);
	const action = my.slice(actionStart, actionEnd);
	expect(action).toContain("navigateToMissedAppointmentsPage");
	expect(action).not.toContain("navigateToPatientScopedPage");
	expect(missed).toContain("onChangePatient");
	expect(missed).not.toContain("redirectToPatientSelector");
	expect(template).not.toContain("正在打开就诊人选择");
	expect(template).not.toContain("selector-card");
	expect(template).not.toContain("pages/patient-select/patient-select");
});

test("native appointment cards keep the legacy hierarchy without decorative stripe and wide shadow", async () => {
	const template = await source(
		"pages/appointment-records/appointment-records.wxml",
	);
	const style = await source(
		"pages/appointment-records/appointment-records.wxss",
	);

	// 记录卡片沿用旧端的科室、状态、医生/院区、日期/时段、号序和操作
	// 顺序；视觉上用轻边界承托信息，不用会抢夺内容层级的侧条和大阴影。
	expect(template).toContain("record-card-header");
	expect(template).toContain("record-card-title-wrap");
	expect(template).toContain("record-schedule");
	expect(template).toContain("record-actions");
	expect(template).not.toContain("record-card-kind");
	expect(style).not.toContain(".record-card::before");
	expect(style).not.toContain("box-shadow: 0 8rpx 24rpx");
});

test("native homepage keeps patient identity and QR data within the safe boundary", async () => {
	const home = await source("pages/index/index.ts");
	const template = await source("pages/index/index.wxml");

	// 首页只能显示服务端脱敏卡号，内部 patientId 只作为后续 API 的 opaque 输入。
	expect(template).toContain("selectedPatient.cardNumberMasked");
	expect(template).not.toContain("ID:{{selectedPatient.id");
	expect(home).toContain('navigateToFeatureStatus("patient-qr")');
	expect(template).toContain("patient-qr-overlay");
	expect(template).toContain("patient-qr-notice");
	expect(home).not.toContain("api.qrserver.com");
	expect(home).not.toContain("medicalCardNo");
});

test("native homepage routes patient binding and report query to real pages", async () => {
	const app = await source("app.json");
	const home = await source("pages/index/index.ts");
	const reportPage = await source("pages/report-directory/report-directory.ts");
	const reportDetailPage = await source("pages/report-detail/report-detail.ts");
	const reportTemplate = await source(
		"pages/report-directory/report-directory.wxml",
	);

	expect(app).toContain('"pages/report-directory/report-directory"');
	expect(home).toContain('action: "patient-select"');
	expect(home).toContain("navigateToPatientScopedPage");
	expect(home).toContain('"/pages/report-directory/report-directory"');
	expect(reportPage).toContain("loadReports");
	expect(reportPage).toContain("onLoadMore");
	expect(reportPage).toContain("loadCurrentPatient");
	expect(reportTemplate).toContain("报告查询");
	expect(reportTemplate).toContain("加载更多报告");
	// 报告详情只接受服务端生成的 opaque reportId 和当前 patientId，目录不透传 provider 报告号。
	expect(reportPage).not.toContain("providerReportId");
	// 详情页在请求前和响应回写前都必须确认当前设备仍选择同一位患者，
	// 防止旧页面栈或慢响应在切换患者后泄漏合法但不属于当前上下文的详情。
	expect(reportDetailPage).toContain("isCurrentSelectedPatient(patientId)");
	expect(reportDetailPage).toContain('code: "patient-selection-required"');
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
		'if (options.skipPatientBootstrap) return "skipped" as const;',
	);
	expect(login).toContain("shouldContinueAfterLogin");
	expect(login).toContain("options.requiresPatient ?? false");
	expect(login).toContain("options.afterSuccess?.()");
});

test("native homepage blocks patient selection while its sync snapshot is in flight", async () => {
	const home = await source("pages/index/index.ts");
	const navigation = await source("services/patient-navigation.ts");
	const start = home.indexOf(
		"openPatientSelector(): void {",
		home.indexOf("Page<"),
	);
	const end = home.indexOf("\n\t},", start);
	const selector = home.slice(start, end);

	// 页面级状态不能覆盖跨页面实例的在途同步；统一导航服务必须检查
	// 进程级协调器，等待当前快照收敛后再让用户进入选择流程。
	expect(selector).toContain("navigateToPatientSelector");
	expect(selector).toContain(
		"sessionVerificationStateFromLabel(this.data.sessionStatus)",
	);
	expect(navigation).toContain("isPatientSyncInFlight");
	expect(navigation).toContain("就诊人正在同步，请稍后");
	expect(navigation).toContain("PatientSelectorNavigationResult");
	expect(navigation).toContain('return "sync-in-flight"');
	const patientScopedPages = [
		"pages/my/my.ts",
		"pages/appointment-records/appointment-records.ts",
		"pages/outpatient-payment/outpatient-payment.ts",
		"pages/report-directory/report-directory.ts",
	];
	for (const pagePath of patientScopedPages) {
		expect(await source(pagePath)).toContain("navigateToPatientSelector");
	}
	const missed = await source(
		"pages/missed-appointments/missed-appointments.ts",
	);
	// 爽约页仍允许用户在已有患者卡片上主动更换就诊人，但不再因为查询
	// 缺少患者上下文而自动导航到选择页。
	expect(missed).toContain("onChangePatient");
	expect(missed).not.toContain("redirectToPatientSelector");
});

test("native homepage uses the same verified session state for every business entry", async () => {
	const home = await source("pages/index/index.ts");
	const sessionService = await source("services/session-service.ts");

	// 首页不能因为本地 token 存在就绕过正在进行的 /me 验证；所有入口都必须
	// 消费同一份 sessionStatus，患者范围页还要继续经过当前患者门禁。
	expect(home).toContain("sessionVerificationStateFromLabel");
	expect(home).toContain("navigateToAuthenticatedPage");
	expect(home).toContain("navigateToPatientScopedPage");
	// 主动登录不能把 code2session 的 token 直接当作入口 owner 证明；
	// session service 必须先复用 `/me` 校验，首页才能把“已登录”交给导航门禁。
	expect(sessionService).toContain(
		"return login().then(() => restorePlatformSession());",
	);
	expect(home).toContain('case "hospital-list":');
	expect(home).toContain("this.onLoadAppointments();");
	expect(home).not.toContain(
		'wx.navigateTo({ url: "/pages/hospital-list/hospital-list" });',
	);

	for (const url of [
		"/pages/report-directory/report-directory",
		"/pages/appointment-records/appointment-records",
		"/pages/outpatient-payment/outpatient-payment",
	]) {
		expect(home).toContain(url);
	}
});

test("native secondary actions use fixed migration routes instead of dead toasts", async () => {
	const appointmentDirectory = await source(
		"pages/appointment-directory/appointment-directory.ts",
	);
	const appointmentRecords = await source(
		"pages/appointment-records/appointment-records.ts",
	);
	const reportDetail = await source("pages/report-detail/report-detail.ts");
	const reportDirectory = await source(
		"pages/report-directory/report-directory.ts",
	);
	const outpatientPayment = await source(
		"pages/outpatient-payment/outpatient-payment.ts",
	);

	expect(appointmentDirectory).toContain(
		'navigateToFeatureStatus("appointment-write")',
	);
	expect(appointmentRecords).toContain(
		'navigateToFeatureStatus("appointment-detail")',
	);
	expect(appointmentRecords).toContain('navigateToFeatureStatus("pre-visit")');
	expect(reportDetail).toContain(
		'navigateToFeatureStatus("report-cloud-image")',
	);
	expect(reportDetail).toContain('navigateToFeatureStatus("report-share")');
	expect(reportDetail).toContain('navigateToFeatureStatus("report-follow-up")');
	expect(reportDirectory).toContain('navigateToFeatureStatus("report-detail")');
	expect(outpatientPayment).toContain("navigateToFeatureStatus");
	expect(outpatientPayment).toContain('"outpatient-payment-write"');
	expect(outpatientPayment).toContain('"outpatient-payment-detail"');

	// 迁移边界的反馈必须能进入稳定页面，不能因为 Toast 消失而让用户
	// 误以为点击没有生效；真实 contract 完成前仍不允许创建业务数据。
	expect(appointmentDirectory).not.toContain("预约下单功能迁移中");
	expect(appointmentRecords).not.toContain("挂号详情暂未开放");
	expect(appointmentRecords).not.toContain("预问诊功能正在迁移中");
	expect(reportDetail).not.toContain("云影像功能迁移中");
	expect(reportDetail).not.toContain("分享功能迁移中");
	expect(reportDetail).not.toContain("复诊功能迁移中");
	expect(reportDirectory).not.toContain("该报告详情暂未开放");
	expect(outpatientPayment).not.toContain("支付流程正在迁移中");
	expect(outpatientPayment).not.toContain("已缴费记录详情正在迁移中");
});

test("native patient center does not mislabel reports as outpatient medical records", async () => {
	const home = await source("pages/index/index.ts");
	const myTemplate = await source("pages/my/my.wxml");
	const myPage = await source("pages/my/my.ts");
	const featureNavigation = await source("services/feature-navigation.ts");

	expect(home).toContain('action: "medical-record"');
	expect(home).toContain('navigateToFeatureEntry("medical-record")');
	expect(myTemplate).toContain('data-action="{{item.action}}"');
	expect(myPage).toContain('action: "medical-record"');
	expect(myTemplate).not.toContain('data-action="reports"');
	expect(myPage).toContain('case "medical-record"');
	expect(featureNavigation).toContain(
		'"medical-record": "/pages/medical-record/medical-record"',
	);
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
	const showStart = home.indexOf("onShow() {");
	const showEnd = home.indexOf("\n\t},", showStart);
	const showBody = home.slice(showStart, showEnd);

	// 选择页同步后可能让旧患者失效，但本地缓存中的旧 ID 仍会保留到
	// 用户显式重选；首页不能用“ID 没变化”误判为仍可展示旧患者。
	expect(home).toContain("hasShown: false");
	expect(home).toContain("if (!this.data.hasShown)");
	expect(home).toContain("if (!hasPlatformSession())");
	expect(showBody).toContain("this.clearDisplayedPatientContext();");
	expect(showBody).not.toContain("clearSelectedPatientId();");
	expect(home).toContain("this.loadPatients()");
	expect(showBody).toContain(
		"shouldContinueAfterPatientLoad(patientLoadResult)",
	);
	expect(home).not.toContain(
		"selectedPatientId === this.data.selectedPatientId",
	);
});

test("native homepage clears stale session display when another page removes the token", async () => {
	const home = await source("pages/index/index.ts");
	const showStart = home.indexOf("onShow() {");
	const showEnd = home.indexOf("\n\t},", showStart);
	const showBody = home.slice(showStart, showEnd);
	const loginStart = home.indexOf("onLogin(options: LoginOptions = {})");
	const loginEnd = home.indexOf("/** 顶部就诊人卡片", loginStart);
	const loginBody = home.slice(loginStart, loginEnd);

	// 其他页面的 401 可能先清除全局 token；首页重新显示时必须同步清理
	// 页面文案，主动登录期间也必须进入 checking，不能残留“微信已登录”。
	expect(showBody).toContain("sessionStatus: SESSION_LABELS.signedOut");
	expect(loginBody).toContain("sessionStatus: SESSION_LABELS.restoring");
});

test("native homepage clears the patient card before validating an existing token onShow", async () => {
	const home = await source("pages/index/index.ts");
	const showStart = home.indexOf("onShow() {");
	const showEnd = home.indexOf("\n\t},", showStart);
	const showBody = home.slice(showStart, showEnd);

	// 本地 token 不是当前 principal 的证明；401 自动重登或 Redis 短暂故障
	// 期间，首页必须先隐藏旧患者，再决定恢复、失效或暂不可用。
	const clearIndex = showBody.indexOf("this.clearDisplayedPatientContext();");
	const loadIndex = showBody.indexOf("this.loadPatients()");
	expect(clearIndex).toBeGreaterThan(-1);
	expect(clearIndex).toBeLessThan(loadIndex);
	expect(showBody).toContain("sessionStatus: SESSION_LABELS.restoring");
	expect(showBody).toContain("sessionStatus: SESSION_LABELS.restored");
	expect(showBody).toContain("!hasPlatformSession()");
});

test("native homepage marks session restored only after the current patient read is loaded", async () => {
	const home = await source("pages/index/index.ts");
	const showStart = home.indexOf("onShow() {");
	const showEnd = home.indexOf("\n\t},", showStart);
	const showBody = home.slice(showStart, showEnd);
	const refreshStart = home.lastIndexOf("\n\tonRefresh(): Promise<void> {");
	const refreshEnd = home.indexOf("\n\t},", refreshStart);
	const refreshBody = home.slice(refreshStart, refreshEnd);

	// 同一首页可能同时收到 onShow、下拉刷新和其它页面返回；被最新目录
	// 周期淘汰的旧请求不能把“验证中”提前改成“已恢复会话”。
	expect(showBody).toContain("patientLoadResult");
	expect(showBody).toContain(
		"shouldContinueAfterPatientLoad(patientLoadResult)",
	);
	expect(refreshBody).toContain("const sessionGuard");
	expect(refreshBody).toContain("sessionGuard.isCurrent(sessionToken)");
	expect(refreshBody).toContain(
		"shouldContinueAfterPatientLoad(patientLoadResult)",
	);
});

test("native homepage restores from the safe directory without implicit provider sync", async () => {
	const home = await source("pages/index/index.ts");
	const loadStart = home.indexOf("onLoad() {");
	const loadEnd = home.indexOf("\n\t},", loadStart);
	const loadBody = home.slice(loadStart, loadEnd);
	const loginStart = home.indexOf("onLogin(options: LoginOptions = {})");
	const loginEnd = home.indexOf("/** 顶部就诊人卡片", loginStart);
	const loginBody = home.slice(loginStart, loginEnd);

	// 首页启动只读当前 owner 的目录；Provider 同步必须由明确的同步入口触发，
	// 不能因为首页生命周期自动发起外部副作用。
	expect(loadBody).toContain("return this.loadPatients();");
	expect(loadBody).not.toContain("this.onSyncPatients()");
	expect(home).toContain(
		"return this.loadPatients().then((patientLoadResult) => {",
	);
	expect(home).toContain("directory-loaded");
	expect(home).toContain("目录中已经确认的 ready 患者");
	expect(loginBody).toContain('return "directory-loaded" as const;');
	expect(loginBody).not.toContain("syncPatientsFromHospital");
});

test("native appointment history pages clear old patient data before reload", async () => {
	for (const file of [
		"pages/appointment-records/appointment-records.ts",
		"pages/missed-appointments/missed-appointments.ts",
	] as const) {
		const page = await source(file);
		const loadStart = file.includes("appointment-records")
			? page.indexOf("loadRecords(tab?: AppointmentRecordTab): Promise<void>")
			: page.indexOf("loadRecords(): Promise<void>");
		const loadEnd = page.indexOf("\n\t},", loadStart);
		const loadBody = page.slice(loadStart, loadEnd);

		// 最新请求守卫只能阻止旧响应回写，不能消除请求等待期间已经展示的旧数据；
		// 记录页必须在发起新患者读取时先清理身份和列表。
		expect(loadBody).toContain("selectedPatient: null");
		expect(loadBody).toContain("records: []");
	}

	const appointmentRecords = await source(
		"pages/appointment-records/appointment-records.ts",
	);
	const errorStart = appointmentRecords.indexOf(
		"showError(error: unknown, fallback: string)",
	);
	const errorEnd = appointmentRecords.indexOf("\n\t},", errorStart);
	const errorBody = appointmentRecords.slice(errorStart, errorEnd);
	// 网络错误必须关闭院区弹层，避免错误条被遮挡后页面无法恢复。
	expect(errorBody).toContain("showHospitalModal: false");
});

test("native homepage fails closed when session recovery cannot be completed", async () => {
	const home = await source("pages/index/index.ts");

	// 401 清除 token 后，微信登录又遇到 503 时，旧页面实例不能继续展示
	// 上一位患者；但本地显式选择仍要保留，后续同账号恢复必须进入原患者
	// 或 stale 分支，不能因为临时失效而静默默认第一位。
	expect(home).toContain(
		"if (!hasPlatformSession()) this.clearDisplayedPatientContext();",
	);
	expect(home).toContain("clearPatientContext(): void");
	expect(home).toContain("auth/wechat");
});

test("native homepage preserves explicit patient choice during session recovery failure", async () => {
	const home = await source("pages/index/index.ts");
	const restoreStart = home.indexOf(
		"restorePlatformSession()",
		home.indexOf("onLoad()"),
	);
	const catchStart = home.indexOf("\n\t\t\t.catch((error) => {", restoreStart);
	const catchEnd = home.indexOf("\n\t\t\t});", catchStart);
	const restoreCatch = home.slice(catchStart, catchEnd);

	// 会话恢复失败只说明当前 principal 尚未重新被证明，不能把用户已经
	// 明确选择的患者 ID 当作页面展示数据一起删除；恢复后必须继续做 owner-scoped
	// 解析，若患者已失效则进入 stale 分支并要求用户显式重选。
	expect(restoreCatch).toContain("this.clearDisplayedPatientContext();");
	expect(restoreCatch).not.toContain("this.clearPatientContext();");
});

test("native homepage preserves explicit patient choice across login failure", async () => {
	const home = await source("pages/index/index.ts");
	const loginStart = home.indexOf("onLogin(options: LoginOptions = {})");
	const loginEnd = home.indexOf("/** 顶部就诊人卡片", loginStart);
	const loginBody = home.slice(loginStart, loginEnd);

	// token 失效和微信重新兑换失败只清理页面派生数据，不删除 storage 中的
	// opaque patientId；下一次成功目录读取才能区分 selected 与 stale，禁止自动换人。
	expect(loginBody).toContain("this.clearDisplayedPatientContext();");
	expect(loginBody).not.toContain("this.clearPatientContext();");
	expect(loginBody).toContain("不能在这里删除本地选择");
});

test("native homepage clears displayed patient context after directory failures", async () => {
	const home = await source("pages/index/index.ts");
	const pageStart = home.indexOf("Page<IndexPageData");
	const loadStart = home.indexOf(
		"loadPatients(restoreSelection = true): Promise<PatientDirectoryLoadResult>",
		pageStart,
	);
	const loadEnd = home.indexOf("\n\t},", loadStart);
	const loadBody = home.slice(loadStart, loadEnd);
	const syncStart = home.indexOf("onSyncPatients(): Promise<", pageStart);
	const syncEnd = home.indexOf("\n\t},", syncStart);
	const syncBody = home.slice(syncStart, syncEnd);

	// 目录读取和临床映射失败都必须清理首页展示；本地选择仍由独立 service
	// 保存，不能把“清理展示”误实现成“删除用户选择”。
	expect(home).toContain("clearDisplayedPatientContext(): void");
	expect(loadBody).toContain("this.clearDisplayedPatientContext();");
	expect(syncBody).toContain("this.clearDisplayedPatientContext();");
	// 同步请求发出前就要撤销旧卡片；否则临床映射尚未确认时，用户仍可把旧患者
	// 当作预约、报告或费用页面的有效上下文。
	expect(syncBody.indexOf("this.clearDisplayedPatientContext();")).toBeLessThan(
		syncBody.indexOf('syncPatientsFromHospital("patient-sync")'),
	);
	// 旧目录请求失去页面/请求资格后必须安静结束，不能把错误冒泡到
	// onShow/onRefresh 的外层回调，再次清空新请求或已卸载页面；同时必须
	// 用显式状态阻止登录恢复链继续启动患者同步，不能返回 [] 冒充成功。
	expect(loadBody).toContain("if (!patientDataGuard.isCurrent(requestToken))");
	expect(loadBody).toContain('return "superseded" as const;');
	expect(home).toContain("getPageLifecycle(this)");
	expect(home).toContain("pageLifecycle.isActive()");
	expect(home).toContain("不向调用方返回患者快照");
	expect(syncBody).not.toContain("return [];");
	expect(home).toContain("保留本地 opaque 选择");
});

test("native homepage only replays patient actions after a confirmed bootstrap", async () => {
	const home = await source("pages/index/index.ts");
	const reportsStart = home.indexOf("onLoadReports() {");
	const reportsEnd = home.indexOf("\n\t},", reportsStart);
	const reports = home.slice(reportsStart, reportsEnd);
	const recordsStart = home.indexOf("onLoadAppointmentRecords() {");
	const recordsEnd = home.indexOf("\n\t},", recordsStart);
	const records = home.slice(recordsStart, recordsEnd);
	const paymentStart = home.indexOf("onLoadOutpatientPayment() {");
	const paymentEnd = home.indexOf("\n\t},", paymentStart);
	const payment = home.slice(paymentStart, paymentEnd);

	// 三个患者范围入口都必须声明 requiresPatient；登录成功但患者同步失败或
	// 目录为空时，afterSuccess 不能把用户直接送入业务页再暴露二次错误。
	expect(reports).toContain("requiresPatient: true");
	expect(records).toContain("requiresPatient: true");
	expect(payment).toContain("requiresPatient: true");
	expect(home).toContain('"failed"');
	expect(home).toContain('"superseded"');
});

test("native my page clears stale patient context when owner reads fail", async () => {
	const my = await source("pages/my/my.ts");

	// 依赖暂时不可用时不能继续展示上一轮患者卡片；同时不删除本地选择，
	// 让下一次成功的 owner-scoped 目录读取仍有机会恢复用户的显式选择。
	expect(my).toContain("全局资料仍然是当前账号的已确认");
	expect(my).toContain("selectedPatient: null");
	expect(my).toContain("patientCount: 0");
	expect(my).toContain("患者目录仍然需要在本页面重新确认");
	expect(my).toContain("patientContextErrorMessage(error, fallback)");
});

test("patient context pull-to-refresh waits for the complete directory lifecycle", async () => {
	const home = await source("pages/index/index.ts");
	const selection = await source("pages/patient-select/patient-select.ts");

	// 首页刷新只覆盖健康检查和安全目录读取；选择页进入时也只读取目录，
	// 只有用户明确点击刷新才覆盖“目录读取 + 临床映射同步”完整链路。
	expect(home).toContain(
		"return Promise.all([this.checkHealth(), patientRefresh])",
	);
	expect(home).toContain(
		"this.onRefresh().finally(() => wx.stopPullDownRefresh())",
	);
	expect(selection).toContain(
		"this.loadPatientList().finally(() => wx.stopPullDownRefresh())",
	);
	const loadPatientListBody = selection.slice(
		selection.indexOf("loadPatientList(): Promise<void>"),
		selection.indexOf(
			"\n\t},",
			selection.indexOf("loadPatientList(): Promise<void>"),
		),
	);
	// 目录读取完成不会隐式进入 Provider；显式同步入口仍由独立方法负责。
	expect(loadPatientListBody).not.toContain(
		"syncPatientDirectoryForLoad(loadToken)",
	);
});

test("native client reads LIS detail only through the opaque Hospital API reference", async () => {
	const client = await source("services/api-client.ts");

	expect(client).toContain("requestReportDetail");
	expect(client).toContain(
		"const patientId = requirePatientScopedId(options?.patientId);",
	);
	expect(client).toContain(
		`/reports/\${encodeURIComponent(options.reportId)}?patientId=\${encodeURIComponent(patientId)}`,
	);
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
	const patientSelectScript = await source(
		"pages/patient-select/patient-select.ts",
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
	expect(homeTemplate).not.toContain("legacy-tabbar");
	expect(await source("app.json")).toContain('"custom": false');
	expect(await source("app.json")).toContain('"position": "bottom"');
	expect(await source("app.json")).toContain(
		'"selectedIconPath": "assets/legacy-home/tab-04-native-active-v6.png"',
	);
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
	expect(patientSelectScript).toContain('other: "其他"');
	expect(patientSelectScript).toContain('unknown: "关系未提供"');
	expect(patientSelectTemplate).toContain(
		'disabled="{{loading || syncing || navigationPending}}"',
	);
	expect(patientSelectScript).toContain(
		"if (this.data.loading || this.data.syncing || this.data.navigationPending)",
	);
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
	expect(service).toContain(
		'AppointmentRecordQueryWindow = "history" | "missed"',
	);
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

test("appointment directory labels provider calendar dates without device timezone drift", () => {
	// workDate 是医院日历值，不能使用设备本地 getMonth/getDate/getDay 推导星期。
	// 逻辑已经抽到纯展示 helper，由行为测试直接验证，而不是依赖页面源码字符串。
	expect(formatAppointmentDateLabel("2026-08-21")).toBe("8月21日 周五");
	expect(formatAppointmentDateLabel("2026-02-30")).toBe("2026-02-30");
});

test("appointment directory ignores stale date events after a cascade refresh", async () => {
	const page = await source(
		"pages/appointment-directory/appointment-directory.ts",
	);
	const dateHandlerStart = page.indexOf("onDateTap(event)");
	const dateHandlerEnd = page.indexOf("\n\t},", dateHandlerStart);
	const dateHandler = page.slice(dateHandlerStart, dateHandlerEnd);

	// 日期事件可能来自刷新前的 WXML；只有当前日期分组中仍存在的日期，
	// 才能改变右侧排班读模型，避免级联页面产生脱离当前科室的 selectedDate。
	expect(dateHandler).toContain("const group = this.data.dateGroups.find");
	expect(dateHandler).toContain("if (!group)");
	expect(dateHandler).toContain("selectedDate,");
});

test("appointment directory ignores stale department events after a cascade refresh", async () => {
	const page = await source(
		"pages/appointment-directory/appointment-directory.ts",
	);
	const departmentHandlerStart = page.indexOf("onDepartmentTap(event)");
	const departmentHandlerEnd = page.indexOf("\n\t},", departmentHandlerStart);
	const departmentHandler = page.slice(
		departmentHandlerStart,
		departmentHandlerEnd,
	);

	// 科室事件也可能来自刷新前的 WXML；必须先在当前科室目录中回查，
	// 再允许改变右栏排班查询条件，避免旧级联上下文重新发起请求。
	expect(departmentHandler).toContain("this.data.departments.find");
	expect(departmentHandler).toContain("if (!department)");
	expect(departmentHandler).toContain(
		"this.loadDepartmentSchedules(department.departmentId)",
	);
});

test("appointment directory load-more events cannot expand a stale local window", async () => {
	const page = await source(
		"pages/appointment-directory/appointment-directory.ts",
	);
	const loadMoreStart = page.indexOf("onLoadMore(): void {");
	const loadMoreEnd = page.indexOf("\n\t},", loadMoreStart);
	const loadMoreHandler = page.slice(loadMoreStart, loadMoreEnd);

	// 加载更多不是 Provider 分页；旧按钮事件只能展开当前日期分组中尚未
	// 展示的安全读模型。刷新或切换期间必须直接忽略，不能把旧点击写入新状态。
	expect(loadMoreHandler).toContain("if (!group || this.data.loading");
	expect(loadMoreHandler).toContain("!this.data.hasMoreSchedules");
	expect(loadMoreHandler).toContain("Math.min(");
	expect(loadMoreHandler).toContain(
		"if (nextCount <= this.data.visibleScheduleCount)",
	);
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
			// 所有使用页面请求守卫的页面都必须在 onUnload 标记实例失效，
			// 否则微信请求晚返回时仍可能对已销毁页面调用 setData。
			expect(page).toContain("disposePageInstance");
			expect(page).toContain("onUnload");
		}
	}
});

test("native session and report detail requests respect page lifetime", async () => {
	const home = await source("pages/index/index.ts");
	const detail = await source("pages/report-detail/report-detail.ts");

	expect(home).toContain('getPageLatestRequestGuard(this, "session")');
	expect(home).toContain("sessionGuard.isCurrent(sessionToken)");
	expect(home).toContain("disposePageInstance(this)");
	expect(detail).toContain('getPageLatestRequestGuard(this, "report-detail")');
	expect(detail).toContain("detailGuard.isCurrent(detailToken)");
	expect(detail).toContain("disposePageInstance(this)");
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
	expect(page).toContain(
		"requestReportDetail(\n\t\t\t\t\t{ patientId, reportId },\n\t\t\t\t\texpectedSessionGeneration,",
	);
	expect(page).toContain('typeof patientId !== "string"');
	expect(page).toContain("report-detail-id-missing");
	expect(template).toContain("report-actions");
	expect(page).not.toContain("providerReportId");
	expect(page).not.toContain("fileUrl");
	expect(template).not.toContain("providerReportId");
});
