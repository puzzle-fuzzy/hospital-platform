import { resolve } from "node:path";
import { LEGACY_PAGE_MIGRATION_CATALOG } from "../apps/miniprogram/src/services/legacy-page-catalog.ts";

/**
 * 尚未具备正式 contract 的页面关闭态审计。
 *
 * `surface-only` 的含义是“入口和页面结构已经迁移，真实业务仍关闭”，
 * 不是“先在页面里试着请求一下”。这份目录把每个入口绑定到它允许使用的
 * 页面工厂或本地安全子集，并在提交门禁中检查生产源码没有出现网络、支付、
 * 外部跳转和微信登录旁路。
 *
 * 该工具只读新端源代码和迁移台账，不访问旧项目、数据库、Redis、Provider
 * 或线上服务；它不能代替真实 contract 和真机验收。
 */

const repositoryRoot = resolve(import.meta.dir, "..");

/**
 * `surface-only` 入口的运行时落点目录。
 *
 * 工厂页只负责患者上下文和关闭态展示；健康自测是唯一的本地安全子集，
 * 因此单独声明所需计算器，而不能把它误当作临床题库或风险评估实现。
 */
export const SURFACE_ONLY_RUNTIME_CATALOG = Object.freeze([
	{
		featureKey: "admission-preconsultation",
		target: "pages/admission-preconsultation/admission-preconsultation",
		mode: "surface-factory",
		source:
			"apps/miniprogram/src/pages/admission-preconsultation/admission-preconsultation.ts",
		registration:
			'registerClinicalContentSurfacePage("admission-preconsultation")',
		sharedSources: [
			"apps/miniprogram/src/services/clinical-content-surface.ts",
		],
	},
	{
		featureKey: "discharge-followup",
		target: "pages/discharge-followup/discharge-followup",
		mode: "surface-factory",
		source:
			"apps/miniprogram/src/pages/discharge-followup/discharge-followup.ts",
		registration: 'registerClinicalContentSurfacePage("discharge-followup")',
		sharedSources: [
			"apps/miniprogram/src/services/clinical-content-surface.ts",
		],
	},
	{
		featureKey: "electronic-consultation",
		target: "pages/electronic-consultation/electronic-consultation",
		mode: "surface-factory",
		source:
			"apps/miniprogram/src/pages/electronic-consultation/electronic-consultation.ts",
		registration: 'registerClinicalSurfacePage("electronic-consultation")',
		sharedSources: ["apps/miniprogram/src/services/clinical-entry-surface.ts"],
	},
	{
		featureKey: "gift-banner",
		target: "pages/gift-banner/gift-banner",
		mode: "surface-factory",
		source: "apps/miniprogram/src/pages/gift-banner/gift-banner.ts",
		registration: 'registerConvenienceSurfacePage("gift-banner")',
		sharedSources: ["apps/miniprogram/src/services/convenience-surface.ts"],
	},
	{
		featureKey: "health-praise",
		target: "pages/health-praise/health-praise",
		mode: "surface-factory",
		source: "apps/miniprogram/src/pages/health-praise/health-praise.ts",
		registration: 'registerConvenienceSurfacePage("health-praise")',
		sharedSources: ["apps/miniprogram/src/services/convenience-surface.ts"],
	},
	{
		featureKey: "health-test",
		target: "pages/health-test/health-test",
		mode: "safe-local-subset",
		source: "apps/miniprogram/src/pages/health-test/health-test.ts",
		requiredFragments: [
			"calculateBmi",
			"recordBloodPressure",
			'navigateToFeatureStatus("health-test")',
		],
	},
	{
		featureKey: "inpatient-center",
		target: "pages/inpatient-center/inpatient-center",
		mode: "surface-factory",
		source: "apps/miniprogram/src/pages/inpatient-center/inpatient-center.ts",
		registration: 'registerClinicalSurfacePage("inpatient-center")',
		sharedSources: ["apps/miniprogram/src/services/clinical-entry-surface.ts"],
	},
	{
		featureKey: "pre-visit",
		target: "pages/pre-visit/pre-visit",
		mode: "surface-factory",
		source: "apps/miniprogram/src/pages/pre-visit/pre-visit.ts",
		registration: 'registerClinicalContentSurfacePage("pre-visit")',
		sharedSources: [
			"apps/miniprogram/src/services/clinical-content-surface.ts",
		],
	},
	{
		featureKey: "risk-evaluation",
		target: "pages/risk-evaluation/risk-evaluation",
		mode: "surface-factory",
		source: "apps/miniprogram/src/pages/risk-evaluation/risk-evaluation.ts",
		registration: 'registerClinicalContentSurfacePage("risk-evaluation")',
		sharedSources: [
			"apps/miniprogram/src/services/clinical-content-surface.ts",
		],
	},
	{
		featureKey: "appointment-detail",
		target: "pages/appointment-detail/appointment-detail",
		mode: "surface-factory",
		source:
			"apps/miniprogram/src/pages/appointment-detail/appointment-detail.ts",
		registration: 'registerProviderEntrySurfacePage("appointment-detail")',
		sharedSources: ["apps/miniprogram/src/services/provider-entry-surface.ts"],
	},
	{
		featureKey: "patient-binding",
		target: "pages/patient-binding/patient-binding",
		mode: "surface-factory",
		source: "apps/miniprogram/src/pages/patient-binding/patient-binding.ts",
		registration: 'registerPatientContractSurfacePage("patient-binding")',
		sharedSources: [
			"apps/miniprogram/src/services/patient-contract-surface.ts",
		],
	},
]);

/** 这些调用一旦出现在关闭态页面，就意味着页面绕过了统一 contract。 */
const FORBIDDEN_RUNTIME_PATTERNS = Object.freeze([
	{ label: "微信直连 HTTP 请求", pattern: /\bwx\.request\s*\(/u },
	{ label: "网络 fetch 请求", pattern: /\bfetch\s*\(/u },
	{ label: "微信支付调起", pattern: /\bwx\.requestPayment\s*\(/u },
	{
		label: "微信登录或用户授权",
		pattern: /\bwx\.(?:login|getUserInfo|getUserProfile)\s*\(/u,
	},
	{
		label: "外部小程序跳转",
		pattern: /\bwx\.(?:navigateToMiniProgram|openEmbeddedMiniProgram)\s*\(/u,
	},
	{ label: "文件上传", pattern: /\bwx\.uploadFile\s*\(/u },
	{
		label: "直接调用请求函数",
		pattern: /\brequest\s*\(\s*\{/u,
	},
]);

/**
 * 导入路径必须在保留字符串的源码上检查。
 *
 * 导入语法的模块路径本身就是字符串；如果复用下面的
 * `stripCommentsAndStrings`，路径会先被清空，导致集中 API client 的
 * 导入规则永远无法命中。调用和导入是两种不同的词法边界，必须分开处理。
 */
const FORBIDDEN_SOURCE_PATTERNS = Object.freeze([
	{
		label: "直接导入集中 API client",
		pattern:
			/\bimport\s+(?:(?:[\s\S]*?)\sfrom\s+)?["'][^"']*api-client[^"']*["']/u,
	},
	{
		label: "动态导入集中 API client",
		pattern: /\b(?:import|require)\s*\(\s*["'][^"']*api-client[^"']*["']/u,
	},
]);

/**
 * 只去掉代码注释，保留字符串内容供导入路径规则检查。
 *
 * 这里仍然跳过引号和模板字符串，避免模块文档、URL 或用户文案里的
 * `//` 被误当成注释；导入规则只需要识别静态模块语句，不需要执行模板
 * 插值，因此模板整体在这个专用扫描中按字符串保留。
 */
function stripComments(source) {
	const output = [];
	let index = 0;
	let quote;
	while (index < source.length) {
		const character = source[index];
		const nextCharacter = source[index + 1];
		if (quote !== undefined) {
			output.push(character);
			if (character === "\\") {
				if (index + 1 < source.length) output.push(source[index + 1]);
				index += 2;
				continue;
			}
			if (character === quote) quote = undefined;
			index += 1;
			continue;
		}
		if (character === "'" || character === '"' || character === "`") {
			quote = character;
			output.push(character);
			index += 1;
			continue;
		}
		if (character === "/" && nextCharacter === "/") {
			index += 2;
			while (index < source.length && source[index] !== "\n") index += 1;
			continue;
		}
		if (character === "/" && nextCharacter === "*") {
			index += 2;
			while (
				index < source.length &&
				!(source[index] === "*" && source[index + 1] === "/")
			) {
				index += 1;
			}
			index = Math.min(source.length, index + 2);
			continue;
		}
		output.push(character);
		index += 1;
	}
	return output.join("");
}

/**
 * 去掉注释和字符串后再做调用级扫描。
 *
 * 关闭态文案会正常出现“请求”“支付”等中文词，不能用整段文本关键字
 * 判断；这里只关心可执行调用，避免注释或用户文案造成误报。模板中的
 * `${...}` 是真正会执行的 JavaScript 表达式，不能和普通模板文案一起
 * 剥掉，否则审计器会漏掉藏在模板插值里的直连请求。模板文案本身仍然
 * 会被清空，`<web-view>` 另行按原文检查，因为它不是 TypeScript 调用。
 */
export function stripCommentsAndStrings(source) {
	const output = [];

	/** 将被忽略的字符替换为空格，但保留换行，方便失败位置仍可定位。 */
	function blank(character) {
		output.push(character === "\n" ? "\n" : " ");
	}

	function blankRange(start, end) {
		for (let index = start; index < end; index += 1) blank(source[index]);
	}

	/** 跳过单引号/双引号字符串，不把字符串里的调用文本当成代码。 */
	function scanQuotedString(start, quote) {
		let index = start;
		while (index < source.length) {
			const character = source[index];
			if (character === "\\") {
				index += 2;
				continue;
			}
			if (character === quote) return index + 1;
			index += 1;
		}
		return index;
	}

	/**
	 * 扫描模板字符串的文案部分；遇到 `${` 时回到代码扫描器，保留其中
	 * 的表达式，并用大括号深度准确找到插值的结束位置。
	 */
	function scanTemplate(start) {
		let index = start;
		while (index < source.length) {
			const character = source[index];
			if (character === "\\") {
				blank(character);
				if (index + 1 < source.length) blank(source[index + 1]);
				index += 2;
				continue;
			}
			if (character === "`") {
				blank(character);
				return index + 1;
			}
			if (character === "$" && source[index + 1] === "{") {
				output.push("$", "{");
				index = scanCode(index + 2, true);
				continue;
			}
			blank(character);
			index += 1;
		}
		return index;
	}

	/** 扫描可执行代码；interpolation=true 时只返回对应插值的大括号。 */
	function scanCode(start, interpolation = false) {
		let index = start;
		let braceDepth = interpolation ? 1 : 0;
		while (index < source.length) {
			const character = source[index];
			const nextCharacter = source[index + 1];

			if (character === "/" && nextCharacter === "/") {
				const commentStart = index;
				index += 2;
				while (index < source.length && source[index] !== "\n") index += 1;
				blankRange(commentStart, index);
				continue;
			}
			if (character === "/" && nextCharacter === "*") {
				const commentStart = index;
				index += 2;
				while (
					index < source.length &&
					!(source[index] === "*" && source[index + 1] === "/")
				) {
					index += 1;
				}
				index = Math.min(source.length, index + 2);
				blankRange(commentStart, index);
				continue;
			}
			if (character === "'" || character === '"') {
				const stringStart = index;
				index = scanQuotedString(index + 1, character);
				blankRange(stringStart, index);
				continue;
			}
			if (character === "`") {
				blank(character);
				index = scanTemplate(index + 1);
				continue;
			}
			if (interpolation && character === "{") braceDepth += 1;
			if (interpolation && character === "}") {
				braceDepth -= 1;
				output.push(character);
				if (braceDepth === 0) return index + 1;
				index += 1;
				continue;
			}
			output.push(character);
			index += 1;
		}
		return index;
	}

	scanCode(0);
	return output.join("");
}

async function readSource(root, relativePath) {
	const absolutePath = resolve(root, relativePath);
	if (!(await Bun.file(absolutePath).exists())) {
		throw new Error(`缺少关闭态审计文件：${relativePath}`);
	}
	return Bun.file(absolutePath).text();
}

function compareSets(actual, expected, label) {
	const failures = [];
	for (const value of expected) {
		if (!actual.has(value)) failures.push(`${label}缺少：${value}`);
	}
	for (const value of actual) {
		if (!expected.has(value)) failures.push(`${label}多出：${value}`);
	}
	return failures;
}

export function inspectForbiddenCalls(relativePath, source) {
	const failures = [];
	const executableSource = stripCommentsAndStrings(source);
	for (const forbidden of FORBIDDEN_RUNTIME_PATTERNS) {
		if (forbidden.pattern.test(executableSource)) {
			failures.push(`${relativePath} 出现${forbidden.label}`);
		}
	}
	const sourceWithoutComments = stripComments(source);
	for (const forbidden of FORBIDDEN_SOURCE_PATTERNS) {
		if (forbidden.pattern.test(sourceWithoutComments)) {
			failures.push(`${relativePath} 出现${forbidden.label}`);
		}
	}
	return failures;
}

/**
 * 执行关闭态页面、共享页面工厂和 WXML 的静态审计。
 *
 * 返回结构化结果，便于 Bun 单测锁定“15 个目标、14 个工厂页、1 个本地
 * 子集”的事实；CLI 输出则给维护者提供具体失败文件和禁止调用名称。
 */
export async function auditSurfaceOnlyClosure(root = repositoryRoot) {
	const failures = [];
	const catalogTargets = new Set(
		LEGACY_PAGE_MIGRATION_CATALOG.filter(
			(entry) => entry.status === "surface-only",
		).map((entry) => entry.nativeTarget),
	);
	const declaredTargets = new Set(
		SURFACE_ONLY_RUNTIME_CATALOG.map((entry) => entry.target),
	);
	failures.push(
		...compareSets(declaredTargets, catalogTargets, "surface-only 目标页"),
	);

	const checked = [];
	const sharedSources = new Set(
		SURFACE_ONLY_RUNTIME_CATALOG.flatMap((entry) => entry.sharedSources ?? []),
	);
	for (const entry of SURFACE_ONLY_RUNTIME_CATALOG) {
		const entryFailures = [];
		const pageSource = await readSource(root, entry.source);
		entryFailures.push(...inspectForbiddenCalls(entry.source, pageSource));
		const templatePath = entry.source.replace(/\.ts$/u, ".wxml");
		const templateSource = await readSource(root, templatePath);
		if (/<web-view\b/u.test(templateSource)) {
			entryFailures.push(`${templatePath} 出现外部 WebView`);
		}
		if (entry.mode === "surface-factory") {
			if (!pageSource.includes(entry.registration)) {
				entryFailures.push(
					`${entry.source} 缺少固定页面工厂注册：${entry.registration}`,
				);
			}
		} else {
			for (const fragment of entry.requiredFragments ?? []) {
				if (!pageSource.includes(fragment)) {
					entryFailures.push(
						`${entry.source} 缺少本地安全子集锚点：${fragment}`,
					);
				}
			}
		}
		checked.push({
			featureKey: entry.featureKey,
			target: entry.target,
			mode: entry.mode,
			passed: entryFailures.length === 0,
			failures: entryFailures,
		});
		failures.push(...entryFailures);
	}

	for (const relativePath of sharedSources) {
		const source = await readSource(root, relativePath);
		failures.push(...inspectForbiddenCalls(relativePath, source));
	}

	return {
		passed: failures.length === 0,
		catalogTargetCount: catalogTargets.size,
		declaredTargetCount: declaredTargets.size,
		factoryPageCount: SURFACE_ONLY_RUNTIME_CATALOG.filter(
			(entry) => entry.mode === "surface-factory",
		).length,
		localSubsetPageCount: SURFACE_ONLY_RUNTIME_CATALOG.filter(
			(entry) => entry.mode === "safe-local-subset",
		).length,
		sharedSourceCount: sharedSources.size,
		checked,
		failures,
	};
}

if (import.meta.main) {
	const report = await auditSurfaceOnlyClosure();
	for (const page of report.checked) {
		console.log(
			`[${page.passed ? "PASS" : "FAIL"}] ${page.featureKey} -> ${page.target} (${page.mode})`,
		);
		for (const failure of page.failures) console.error(`- ${failure}`);
	}
	if (report.failures.length > 0) {
		console.error(
			`Surface-only closure audit failed: ${report.failures.length} rule(s)`,
		);
		process.exitCode = 1;
	} else {
		console.log(
			`Surface-only closure audit passed: ${report.declaredTargetCount} target page(s), ${report.factoryPageCount} surface factory page(s), ${report.localSubsetPageCount} safe local subset page(s)`,
		);
	}
}
