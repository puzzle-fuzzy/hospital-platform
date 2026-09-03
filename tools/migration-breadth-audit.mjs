import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 跨页面入口广度审计。
 *
 * 首页和“我的”都保留了旧端可见的服务入口。迁移期间最容易出现的
 * 不是某个 API 类型错误，而是入口文案已经画出来了，却漏了 action
 * 分发，最后变成点击无响应、404，或者绕过统一状态页。这个审计只检查
 * 入口是否存在明确的代码分支，以及状态页 key 是否来自固定目录；它不
 * 把一个分支的存在解释成对应 Provider、支付或临床业务已经完成。
 */

const repositoryRoot = new URL("../", import.meta.url);
const repositoryPath = fileURLToPath(repositoryRoot);

const ACTION_SOURCES = [
	{
		id: "首页",
		file: "apps/miniprogram/src/pages/index/index.ts",
		dispatchMethod: "executeQuickAction",
	},
	{
		id: "我的",
		file: "apps/miniprogram/src/pages/my/my.ts",
		dispatchMethod: "onAction",
	},
];

/**
 * 二级页面也会直接进入统一状态页，但它们不属于首页/“我的”的 action
 * 数据目录。这里为这些调用建立稳定的人类可读页面标识，防止只审首页和
 * “我的”时遗漏预约、报告、费用等页面里的高风险入口。
 */
const FEATURE_STATUS_PAGE_LABELS = Object.freeze({
	"pages/index/index": "首页",
	"pages/my/my": "我的",
	"pages/appointment-directory/appointment-directory": "预约目录",
	"pages/confirm-registration/confirm-registration": "确认挂号信息",
	"pages/appointment-records/appointment-records": "预约记录",
	"pages/report-directory/report-directory": "报告目录",
	"pages/report-detail/report-detail": "报告详情",
	"pages/outpatient-payment/outpatient-payment": "门诊费用",
	"pages/patient-select/patient-select": "选择就诊人",
});

const readSource = (root, relativePath) =>
	Bun.file(resolve(root, relativePath)).text();

/** 从当前页面的数据目录读取所有可见 action，重复入口只保留一次。 */
function extractActions(source) {
	return [
		...new Set(
			[...source.matchAll(/\baction:\s*"([^"]+)"/gu)].map((match) => match[1]),
		),
	];
}

/**
 * 取得一个 dispatch 方法的 switch 代码范围。
 *
 * 当前两个页面都使用固定 switch；如果以后改成动态反射或任意 URL
 * 分发，这里会因为找不到固定方法而 fail-closed，提醒重新设计门禁。
 */
function dispatchBody(source, methodName) {
	// 类型声明也会出现同名方法，但它以分号结尾；只接受 Page 对象中
	// 真正带函数体的最后一个声明，避免把类型接口误当成分发实现。
	const methodPattern = new RegExp(
		`\\n\\s*${methodName}\\s*\\([^\\n]*\\)(?:\\s*:\\s*[^\\{]+)?\\s*\\{`,
		"gu",
	);
	const matches = [...source.matchAll(methodPattern)];
	const methodMatch = matches.at(-1);
	if (!methodMatch || methodMatch.index === undefined) return "";
	return source.slice(methodMatch.index);
}

function extractCases(source) {
	return [
		...new Set(
			[...source.matchAll(/\bcase\s+"([^"]+)":/gu)].map((match) => match[1]),
		),
	];
}

function extractFeatureKeys(source) {
	return [
		...new Set(
			[
				...source.matchAll(/navigateToFeature(?:Status|Entry)\("([^"]+)"\)/gu),
			].map((match) => match[1]),
		),
	];
}

/**
 * 提取任意页面调用统一状态页时传入的固定 key。
 *
 * 大多数调用只有一个字符串；门诊费用还会在三元表达式中根据已缴/待缴
 * 分别传入两个 key，因此不能只用“调用后紧跟一个字符串”的正则。这里
 * 只读取调用括号内的字符串字面量，不执行源码，也不接受动态 URL。
 */
function extractFeatureStatusCalls(source, pageLabel, knownFeatureKeys) {
	const calls = [];
	for (const match of source.matchAll(/navigateToFeatureStatus\(([^)]*)\)/gu)) {
		for (const featureMatch of match[1].matchAll(/"([^"]+)"/gu)) {
			if (knownFeatureKeys.has(featureMatch[1])) {
				calls.push(`${pageLabel}:${featureMatch[1]}`);
			}
		}
	}
	return [...new Set(calls)];
}

/**
 * 提取 WXML 上声明的页面事件处理器。
 *
 * 原生小程序不会因为 WXML 中的 bindtap/bindinput 拼写错误而让
 * TypeScript 编译失败；如果只跑 typecheck，用户仍可能遇到点击无响应。
 * 这里统一读取 bind/catch 事件，覆盖点击、输入、选择和地图错误等入口。
 */
function extractWxmlHandlers(source) {
	return [
		...new Set(
			[
				...source.matchAll(
					/\b(?:bind|catch)(?::[A-Za-z][\w-]*|[A-Za-z][\w-]*)\s*=\s*(["'])([A-Za-z_$][\w$]*)\1/gu,
				),
			].map((match) => match[2]),
		),
	];
}

/** 从页面 Page 对象中提取带函数体的方法名。 */
function extractPageMethods(source) {
	const controlFlowNames = new Set(["if", "for", "while", "switch", "catch"]);
	const methods = [
		...new Set(
			[
				...source.matchAll(
					/^\s*(?!Page\s*\()(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{}]+)?\s*\{/gmu,
				),
			]
				.map((match) => match[1])
				.filter((name) => !controlFlowNames.has(name)),
		),
	];

	/**
	 * 页面外壳由共享工厂注册 Page 对象；这些方法真实存在于对应的
	 * service 文件，而不是重复复制到每个页面入口中。审计这里显式识别
	 * 两种安全外壳工厂，避免把合法复用误报成 WXML 断链。
	 */
	if (source.includes("registerClinicalSurfacePage(")) {
		methods.push(
			"onRetry",
			"onOpenPatientSelector",
			"onOpenMigrationStatus",
			"onBackHome",
		);
	}
	if (source.includes("registerPatientContractSurfacePage(")) {
		methods.push(
			"onOpenPatientSelector",
			"onBackPatientSelector",
			"onOpenMigrationStatus",
			"onOpenPatientAgreement",
			"onBackMy",
		);
	}
	if (source.includes("registerClinicalContentSurfacePage(")) {
		methods.push(
			"onRetry",
			"onOpenPatientSelector",
			"onOpenMigrationStatus",
			"onBackHome",
		);
	}
	if (source.includes("registerExternalEntrySurfacePage(")) {
		methods.push(
			"onOpenPatientSelector",
			"onRetry",
			"onOpenMigrationStatus",
			"onBackHome",
		);
	}
	if (source.includes("registerProviderEntrySurfacePage(")) {
		methods.push(
			"onRetry",
			"onOpenPatientSelector",
			"onOpenMigrationStatus",
			"onBackHome",
		);
	}
	if (source.includes("registerConvenienceSurfacePage(")) {
		methods.push(
			"onRetry",
			"onOpenPatientSelector",
			"onOpenMigrationStatus",
			"onBackHome",
		);
	}

	return [...new Set(methods)];
}

/**
 * 校验单个页面的 WXML 事件是否都有对应的 TS 方法。
 *
 * 这是纯函数，测试可以覆盖“事件缺方法”这一类最容易被微信运行时
 * 静默吞掉的错误；真正的文件遍历由下面的审计入口负责。
 */
export function auditPageInteractionSource(wxmlSource, pageSource) {
	const handlers = extractWxmlHandlers(wxmlSource);
	const methods = new Set(extractPageMethods(pageSource));
	const missingHandlers = handlers.filter((handler) => !methods.has(handler));
	return {
		handlers,
		methods: [...methods],
		missingHandlers,
		passed: missingHandlers.length === 0,
	};
}

/** 对 app.json 注册的全部页面执行 WXML/TS 事件闭环审计。 */
async function auditPageInteractions(root, appConfig) {
	const failures = [];
	const pages = [];
	for (const pagePath of appConfig.pages ?? []) {
		const wxmlPath = resolve(root, "apps/miniprogram/src", `${pagePath}.wxml`);
		const tsPath = resolve(root, "apps/miniprogram/src", `${pagePath}.ts`);
		const missingFiles = [];
		if (!(await Bun.file(wxmlPath).exists())) {
			missingFiles.push(`${pagePath}.wxml`);
		}
		if (!(await Bun.file(tsPath).exists())) {
			missingFiles.push(`${pagePath}.ts`);
		}
		if (missingFiles.length > 0) {
			failures.push(
				`${pagePath} 缺少页面交互源文件：${missingFiles.join(", ")}`,
			);
			pages.push({
				pagePath,
				handlerCount: 0,
				handlers: [],
				missingHandlers: [],
				missingFiles,
				passed: false,
			});
			continue;
		}
		const wxmlSource = await Bun.file(wxmlPath).text();
		const pageSource = await Bun.file(tsPath).text();
		const interaction = auditPageInteractionSource(wxmlSource, pageSource);
		for (const handler of interaction.missingHandlers) {
			failures.push(`${pagePath} 的 WXML 事件没有 TS 方法：${handler}`);
		}
		pages.push({
			pagePath,
			handlerCount: interaction.handlers.length,
			handlers: interaction.handlers,
			missingHandlers: interaction.missingHandlers,
			missingFiles: [],
			passed: interaction.passed,
		});
	}
	return {
		pageCount: pages.length,
		pages,
		failures,
		passed: failures.length === 0,
	};
}

/**
 * 检查首页、“我的”和统一状态目录之间的静态关系。
 *
 * 返回结构化结果，既可供 CLI 打印，也可由 Bun 测试直接断言，避免只
 * 依赖人工阅读页面源码。
 */
export async function auditMigrationBreadth(root = repositoryPath) {
	const appConfig = JSON.parse(
		await readSource(root, "apps/miniprogram/src/app.json"),
	);
	const featureNavigation = await import(
		new URL(
			"../apps/miniprogram/src/services/feature-navigation.ts",
			import.meta.url,
		)
	);
	const knownFeatureKeys = new Set(
		Object.keys(featureNavigation.FEATURE_STATUS_CATALOG),
	);
	const failures = [];
	const pages = [];
	const allFeatureKeys = new Set();
	const featureStatusActions = new Set();

	for (const sourceConfig of ACTION_SOURCES) {
		const source = await readSource(root, sourceConfig.file);
		const actions = extractActions(source);
		const body = dispatchBody(source, sourceConfig.dispatchMethod);
		const cases = new Set(extractCases(body));
		const missingCases = actions.filter((action) => !cases.has(action));
		const featureKeys = extractFeatureKeys(body);
		const unknownFeatureKeys = featureKeys.filter(
			(key) => !knownFeatureKeys.has(key),
		);

		for (const key of featureKeys) allFeatureKeys.add(key);
		if (!body) {
			failures.push(
				`${sourceConfig.id} 缺少固定分发方法：${sourceConfig.dispatchMethod}`,
			);
		}
		for (const action of missingCases) {
			failures.push(`${sourceConfig.id} 的 action 没有分发分支：${action}`);
		}
		for (const key of unknownFeatureKeys) {
			failures.push(`${sourceConfig.id} 引用了未知 FeatureKey：${key}`);
		}

		pages.push({
			id: sourceConfig.id,
			file: sourceConfig.file,
			actionCount: actions.length,
			actions,
			missingCases,
			featureKeys,
			unknownFeatureKeys,
			passed: missingCases.length === 0 && unknownFeatureKeys.length === 0,
		});
	}

	/**
	 * 首页/“我的”之外的页面也必须纳入状态入口审计。页面标签使用固定
	 * 目录，未知页面不会被静默归类，新增二级页面时需要显式补登记。
	 */
	for (const pagePath of appConfig.pages ?? []) {
		const pageSourcePath = `${pagePath}.ts`;
		const pageSourceFile = Bun.file(
			resolve(root, "apps/miniprogram/src", pageSourcePath),
		);
		if (!(await pageSourceFile.exists())) continue;
		const pageLabel = FEATURE_STATUS_PAGE_LABELS[pagePath];
		if (!pageLabel) continue;
		const source = await pageSourceFile.text();
		for (const action of extractFeatureStatusCalls(
			source,
			pageLabel,
			knownFeatureKeys,
		)) {
			featureStatusActions.add(action);
			allFeatureKeys.add(action.slice(action.indexOf(":") + 1));
		}
	}

	/**
	 * 状态目录必须仍然是受控的本地图片目录；这里同时检查所有被分发
	 * 分支引用的 key，防止新增入口只写了文案却漏掉用户可读状态说明。
	 */
	for (const key of allFeatureKeys) {
		const feature = featureNavigation.FEATURE_STATUS_CATALOG[key];
		if (!feature) continue;
		const iconPath = feature.icon.replace(/^\/+/, "");
		if (!iconPath.startsWith("assets/")) {
			failures.push(
				`FeatureKey ${key} 的状态图标不是本地 assets：${feature.icon}`,
			);
			continue;
		}
		if (
			!(await Bun.file(
				resolve(root, "apps/miniprogram/src", iconPath),
			).exists())
		) {
			failures.push(`FeatureKey ${key} 的状态图标不存在：${feature.icon}`);
		}
	}

	// 入口广度不仅包含首页/我的的 action，也包含每个已注册页面的
	// WXML 事件。先完成事件闭环，再谈真实 Provider 业务，避免迁移过程中
	// 出现“页面存在但交互无响应”的假完成状态。
	const interactionAudit = await auditPageInteractions(root, appConfig);
	failures.push(...interactionAudit.failures);

	/**
	 * 原生 app.json 的四个主入口是共享底栏的唯一事实源；广度审计顺手
	 * 检查它们仍然是注册页面，避免入口分发正确但运行时又回到 404。
	 */
	const tabBarPages =
		appConfig.tabBar?.list?.map((item) => item.pagePath) ?? [];
	for (const pagePath of tabBarPages) {
		if (!appConfig.pages.includes(pagePath)) {
			failures.push(`主 Tab 未注册到 app.json pages：${pagePath}`);
		}
	}

	return {
		pages,
		featureKeyCount: allFeatureKeys.size,
		featureStatusActions: [...featureStatusActions].sort(),
		tabBarPageCount: tabBarPages.length,
		interactionAudit,
		failures,
		passed: failures.length === 0,
	};
}

if (import.meta.main) {
	const result = await auditMigrationBreadth();
	for (const page of result.pages) {
		console.log(
			`[${page.passed ? "PASS" : "FAIL"}] ${page.id}：${page.actionCount} 个可见 action，${page.featureKeys.length} 个状态页 key`,
		);
	}
	if (!result.passed) {
		console.error(
			`Migration breadth audit failed: ${result.failures.length} rule(s)`,
		);
		for (const failure of result.failures) console.error(`- ${failure}`);
		process.exitCode = 1;
	} else {
		console.log(
			`Migration breadth audit passed: ${result.pages.length} action pages, ${result.featureStatusActions.length} feature-status calls, ${result.interactionAudit.pageCount} interaction pages, ${result.tabBarPageCount} primary tabs`,
		);
	}
}
