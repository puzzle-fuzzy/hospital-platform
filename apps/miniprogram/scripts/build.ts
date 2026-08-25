import {
	access,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	rename,
	rm,
} from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { resolveMiniProgramSourceRevision } from "./runtime-provenance";
import {
	findForbiddenWorkspaceImports,
	findMissingRelativeImports,
	createMiniProgramRuntimeLockError,
	getMiniProgramPendingRuntimePath,
	isMiniProgramRuntimeLockError,
	listRuntimeFiles,
	publishMiniProgramRuntime,
} from "./runtime-publisher";

const root = join(import.meta.dir, "..");
const repositoryRoot = join(root, "..", "..");
const source = join(root, "src");
const runtime = join(root, "dist");
const projectConfigPath = join(root, "project.config.json");
const privateProjectConfigPath = join(root, "project.private.config.json");
const nestedSourceProjectConfigPath = join(source, "project.config.json");
const buildConfigPath = join(root, "tsconfig.build.json");
const requiredStaticFiles = [
	"app.json",
	"app.wxss",
	"sitemap.json",
	"pages/index/index.json",
	"pages/index/index.wxml",
	"pages/index/index.wxss",
	"pages/consult/consult.json",
	"pages/consult/consult.wxml",
	"pages/consult/consult.wxss",
	"pages/hospital/hospital.json",
	"pages/hospital/hospital.wxml",
	"pages/hospital/hospital.wxss",
	"pages/official-account/official-account.json",
	"pages/official-account/official-account.wxml",
	"pages/official-account/official-account.wxss",
	"pages/feedback/feedback.json",
	"pages/feedback/feedback.wxml",
	"pages/feedback/feedback.wxss",
	"pages/patient-select/patient-select.json",
	"pages/patient-select/patient-select.wxml",
	"pages/patient-select/patient-select.wxss",
	"pages/hospital-list/hospital-list.json",
	"pages/hospital-list/hospital-list.wxml",
	"pages/hospital-list/hospital-list.wxss",
	"pages/appointment-directory/appointment-directory.json",
	"pages/appointment-directory/appointment-directory.wxml",
	"pages/appointment-directory/appointment-directory.wxss",
	"pages/appointment-records/appointment-records.json",
	"pages/appointment-records/appointment-records.wxml",
	"pages/appointment-records/appointment-records.wxss",
	"pages/missed-appointments/missed-appointments.json",
	"pages/missed-appointments/missed-appointments.wxml",
	"pages/missed-appointments/missed-appointments.wxss",
	"pages/report-directory/report-directory.json",
	"pages/report-directory/report-directory.wxml",
	"pages/report-directory/report-directory.wxss",
	"pages/report-detail/report-detail.json",
	"pages/report-detail/report-detail.wxml",
	"pages/report-detail/report-detail.wxss",
	"pages/outpatient-payment/outpatient-payment.json",
	"pages/outpatient-payment/outpatient-payment.wxml",
	"pages/outpatient-payment/outpatient-payment.wxss",
	"pages/profile/profile.json",
	"pages/profile/profile.wxml",
	"pages/profile/profile.wxss",
	"pages/hospital-navigation/hospital-navigation.json",
	"pages/hospital-navigation/hospital-navigation.wxml",
	"pages/hospital-navigation/hospital-navigation.wxss",
	"pages/feature-status/feature-status.json",
	"pages/feature-status/feature-status.wxml",
	"pages/feature-status/feature-status.wxss",
	"pages/my/my.json",
	"pages/my/my.wxml",
	"pages/my/my.wxss",
];
const requiredTypeScriptFiles = [
	"app.ts",
	"data/department-location.ts",
	"services/api-client.ts",
	"services/dashboard-service.ts",
	"services/session-service.ts",
	"services/patient-selection-service.ts",
	// 页面实例的单飞依赖曾导致真机误请求 `single-flight.test.js`；
	// 将生产实现列为显式运行模块，避免间接 import 被构建或开发者工具增量索引遗漏。
	"services/single-flight.ts",
	"pages/patient-select/patient-select.ts",
	"pages/official-account/official-account.ts",
	"pages/feedback/feedback.ts",
	"pages/hospital-list/hospital-list.ts",
	"pages/appointment-directory/appointment-directory.ts",
	"pages/appointment-records/appointment-records.ts",
	"pages/missed-appointments/missed-appointments.ts",
	"pages/report-directory/report-directory.ts",
	"pages/index/index.ts",
	"pages/consult/consult.ts",
	"pages/hospital/hospital.ts",
	"pages/report-detail/report-detail.ts",
	"pages/outpatient-payment/outpatient-payment.ts",
	"pages/profile/profile.ts",
	"pages/hospital-navigation/hospital-navigation.ts",
	"pages/feature-status/feature-status.ts",
	"pages/my/my.ts",
];
const requiredAssetDirectories = ["assets"];

type MiniProgramBuildInfo = {
	schemaVersion: 1;
	sourceRevision: string;
	pageCount: number;
	generatedAt: string;
};

/**
 * 构建来源必须能被真机验收人员复核。优先允许发布流水线显式传入来源，
 * 本地开发则从最近一次影响小程序运行输入的 Git 提交读取；两条路径都只
 * 接受完整 40 位小写提交号，避免把分支名、短提交号或用户隐私写进运行包。
 */
function resolveSourceRevision(): string {
	return resolveMiniProgramSourceRevision(
		repositoryRoot,
		process.env.HOSPITAL_MINIPROGRAM_SOURCE_REVISION,
		"HOSPITAL_MINIPROGRAM_SOURCE_REVISION",
	);
}

/**
 * 原生小程序的业务源代码仍然全部使用 TypeScript，但运行目录必须提供真实的
 * JavaScript 页面文件。这样真机上传不依赖开发者工具是否成功执行隐式 TS 插件，
 * 也不会再因为缺少 `pages/report-directory/report-directory.js` 而在运行时失败。
 */
const projectConfig = JSON.parse(await Bun.file(projectConfigPath).text()) as {
	appid?: unknown;
	description?: unknown;
	miniprogramRoot?: unknown;
	projectname?: unknown;
	packOptions?: {
		ignore?: unknown;
	};
	setting?: {
		compileHotReLoad?: unknown;
		useCompilerPlugins?: unknown;
	};
};

/**
 * 热重载适合普通前端页面开发，但不适合这个“完整 dist 运行包 + 微信原生
 * TabBar”的验收边界。它会在开发者工具仍持有旧页面实例时增量替换单个页面，
 * 造成底栏首帧闪动或暂时回到旧的普通图标。公共配置先固定关闭；下面还会
 * 对本机 private 配置重复校验，防止开发者工具用本机覆盖值把它重新打开。
 */
if (projectConfig.setting?.compileHotReLoad !== false) {
	throw new Error(
		"Mini program project.config.json must keep setting.compileHotReLoad=false",
	);
}

/**
 * CommonJS 页面脚本的间接依赖不能交给开发者工具的“未使用文件”推断。
 * private 配置不纳入 Git，但只要本机存在，就必须关闭该优化，否则真实存在的
 * `services/*.js` 可能不会进入调试模块图，最终在模拟器/真机报模块未定义。
 */
let privateProjectConfigExists = true;
try {
	await access(privateProjectConfigPath);
} catch {
	// CI 或新机器可能还没有开发者工具生成的 private 配置，此时不阻断构建。
	privateProjectConfigExists = false;
}
if (privateProjectConfigExists) {
	const privateProjectConfig = JSON.parse(
		await Bun.file(privateProjectConfigPath).text(),
	) as {
		miniprogramRoot?: unknown;
		setting?: {
			compileHotReLoad?: unknown;
			ignoreDevUnusedFiles?: unknown;
		};
	};
	if (
		privateProjectConfig.miniprogramRoot !== undefined &&
		privateProjectConfig.miniprogramRoot !== "dist/"
	) {
		throw new Error(
			"Mini program project.private.config.json must point to the generated dist/ runtime",
		);
	}
	if (privateProjectConfig.setting?.compileHotReLoad !== false) {
		throw new Error(
			"Mini program project.private.config.json must keep setting.compileHotReLoad=false",
		);
	}
	if (privateProjectConfig.setting?.ignoreDevUnusedFiles !== false) {
		throw new Error(
			"Mini program project.private.config.json must keep setting.ignoreDevUnusedFiles=false",
		);
	}
}

if (projectConfig.miniprogramRoot !== "dist/") {
	throw new Error(
		"Mini program project.config.json must point to the generated dist/ runtime",
	);
}

/**
 * 微信开发者工具会监听项目根目录，而不是只监听 `miniprogramRoot`。
 * `src/` 是 TypeScript 唯一源码层，`dist/` 才是小程序唯一运行层；如果
 * 不把源码目录加入忽略清单，工具可能在完整运行包之外继续响应
 * `src/app.json` 或旧资源变化，出现页面 404、底栏闪动和选中资源失效。
 * 这里把该工程边界变成构建硬门禁，避免只依赖人工记忆配置。
 */
const ignoredProjectFolders = new Set(
	Array.isArray(projectConfig.packOptions?.ignore)
		? projectConfig.packOptions.ignore
				.filter(
					(item): item is { type?: unknown; value?: unknown } =>
						typeof item === "object" && item !== null,
				)
				.filter((item) => item.type === "folder")
				.map((item) => item.value)
				.filter((value): value is string => typeof value === "string")
		: [],
);
if (!ignoredProjectFolders.has("src")) {
	throw new Error(
		"Mini program project.config.json must ignore the TypeScript src/ folder; DevTools must compile only dist/",
	);
}

if (
	!Array.isArray(projectConfig.setting?.useCompilerPlugins) ||
	!projectConfig.setting.useCompilerPlugins.includes("typescript")
) {
	throw new Error(
		"Mini program project.config.json must keep the TypeScript compiler plugin enabled",
	);
}

/**
 * 开发者工具不能同时看到“仓库根项目”和嵌套在 src/ 里的第二个项目。
 *
 * 之前为了兼容误打开 src/ 的场景，在 src/ 下保留过一份被忽略的
 * project.config.json。它会让微信工具监听并增量编译 src/app.json、旧的
 * 自绘底栏目录以及生成的 *.js；即使 dist/ 已经是完整运行包，工具仍可能
 * 把两套页面图拼在一起，表现为主 Tab 闪动、选中图标消失和页面 404。
 * 现在只允许 apps/miniprogram/project.config.json 作为微信项目入口；发现
 * 嵌套配置就直接阻断构建，避免把不确定的开发者工具状态带入真机验收。
 */
if (await Bun.file(nestedSourceProjectConfigPath).exists()) {
	throw new Error(
		"apps/miniprogram/src/project.config.json must be removed; open apps/miniprogram as the only DevTools project root",
	);
}

const appConfig = JSON.parse(
	await Bun.file(join(source, "app.json")).text(),
) as {
	pages?: unknown;
	tabBar?: {
		[key: string]: unknown;
		custom?: unknown;
		position?: unknown;
		list?: unknown;
	};
};
if (
	!Array.isArray(appConfig.pages) ||
	appConfig.pages.length === 0 ||
	appConfig.pages.some(
		(page) =>
			typeof page !== "string" ||
			page.trim().length === 0 ||
			page.startsWith("/") ||
			page.includes(".."),
	)
) {
	throw new Error(
		"Mini program app.json pages must be non-empty, relative paths without parent traversal",
	);
}

/** app.json pages 是 Tab 路由和所有页面运行时完整性校验的唯一注册表。 */
const appPagePaths = appConfig.pages as string[];

/**
 * 四个主入口必须交给微信原生 tabBar 统一维护。页面自身不能复制底栏，
 * 业务代码也不能使用 navigateTo 打开主 Tab；这样底栏由微信运行时统一持有，
 * 选中图标和切换生命周期不依赖页面代码。
 */
if (
	appConfig.tabBar?.custom !== false ||
	appConfig.tabBar?.position !== "bottom"
) {
	throw new Error(
		"Mini program primary tabs must use the official native tabBar; custom=false and position=bottom are required",
	);
}

/**
 * 原生 tabBar 只能使用微信官方字段。
 *
 * `height`、`fontSize`、`iconWidth`、`spacing` 是其他小程序框架常见的
 * 配置项，不是微信原生 `app.json.tabBar` 的尺寸控制字段。它们即使被
 * 开发者工具暂时忽略，也会让源码产生“原生和自定义配置混用”的歧义；
 * 真机又无法按这些字段调整原生底栏，最终就会出现源码与设备表现不一致。
 * 原生底栏的高度、字体和安全区由微信运行时管理，视觉一致性只通过官方
 * 颜色字段、页面顺序和 81×81 图标资源保证。
 */
const nativeTabBarKeys = new Set([
	"custom",
	"position",
	"color",
	"selectedColor",
	"backgroundColor",
	"borderStyle",
	"list",
]);
const unsupportedNativeTabBarKeys = Object.keys(appConfig.tabBar ?? {}).filter(
	(key) => !nativeTabBarKeys.has(key),
);
if (unsupportedNativeTabBarKeys.length > 0) {
	throw new Error(
		`Mini program native tabBar contains unsupported fields: ${unsupportedNativeTabBarKeys.join(", ")}. Use only official native tabBar fields; do not mix framework sizing fields into app.json.`,
	);
}

/**
 * 原生 tabBar 的图标仍纳入构建资源校验；只校验 JSON 字符串还不够，
 * 运行包缺图时组件会静默显示空白，用户会误以为选中效果失效。
 */
const primaryTabList = appConfig.tabBar?.list;
if (!Array.isArray(primaryTabList) || primaryTabList.length !== 4) {
	throw new Error(
		"Mini program native tabBar must declare exactly four primary entries",
	);
}

/**
 * 原生 tabBar 使用的图标保留 81×81 PNG 作为稳定输入。
 *
 * 旧资源虽然能被部分基础库缩放，但在真机缓存/渲染层切换时可能出现
 * 微信读取到不合规资源。构建阶段直接读取 PNG 的 IHDR，避免把尺寸不合规
 * 的资源再次发布；这只约束导航图标，不影响页面内其它插图的原始尺寸。
 */
async function readPngDimensions(filePath: string): Promise<{
	height: number;
	width: number;
}> {
	const bytes = await Bun.file(filePath).bytes();
	if (
		bytes.length < 24 ||
		bytes[0] !== 0x89 ||
		bytes[1] !== 0x50 ||
		bytes[2] !== 0x4e ||
		bytes[3] !== 0x47
	) {
		throw new Error(`Mini program tabBar asset must be a PNG: ${filePath}`);
	}
	const readUint32 = (offset: number): number =>
		(bytes[offset] ?? 0) * 16_777_216 +
		(bytes[offset + 1] ?? 0) * 65_536 +
		(bytes[offset + 2] ?? 0) * 256 +
		(bytes[offset + 3] ?? 0);
	return { width: readUint32(16), height: readUint32(20) };
}

for (const item of primaryTabList) {
	if (
		typeof item !== "object" ||
		item === null ||
		typeof (item as { pagePath?: unknown }).pagePath !== "string" ||
		typeof (item as { iconPath?: unknown }).iconPath !== "string" ||
		typeof (item as { selectedIconPath?: unknown }).selectedIconPath !==
			"string"
	) {
		throw new Error(
			"Mini program shared tabBar entries must include pagePath, iconPath and selectedIconPath",
		);
	}
	const tab = item as {
		pagePath: string;
		iconPath: string;
		selectedIconPath: string;
	};
	if (!appPagePaths.includes(tab.pagePath)) {
		throw new Error(
			`Mini program tabBar page is not registered in app.json pages: ${tab.pagePath}`,
		);
	}
	for (const assetPath of [tab.iconPath, tab.selectedIconPath]) {
		if (assetPath.startsWith("/") || assetPath.includes("..")) {
			throw new Error(
				`Mini program shared tabBar asset must be a relative path without traversal: ${assetPath}`,
			);
		}
		await access(join(source, assetPath));
		const dimensions = await readPngDimensions(join(source, assetPath));
		if (dimensions.width !== 81 || dimensions.height !== 81) {
			throw new Error(
				`Mini program native tabBar asset must be 81x81: ${assetPath} (${dimensions.width}x${dimensions.height})`,
			);
		}
	}
	const normalIconBytes = await Bun.file(join(source, tab.iconPath)).bytes();
	const selectedIconBytes = await Bun.file(
		join(source, tab.selectedIconPath),
	).bytes();
	const sameIconBytes =
		normalIconBytes.byteLength === selectedIconBytes.byteLength &&
		normalIconBytes.every((byte, index) => byte === selectedIconBytes[index]);
	if (sameIconBytes) {
		throw new Error(
			`Mini program shared tabBar icon and selectedIconPath must be different files: ${tab.iconPath}`,
		);
	}
}

/**
 * app.json 是小程序真正的页面入口，不能只依赖下面手工维护的“重点文件”列表。
 * 每个入口必须同时拥有页面配置、模板、样式和 TypeScript 源码，构建完成后还
 * 必须拥有同名 JavaScript 运行文件，从源代码到真机上传包形成闭环门禁。
 */
/** 对正则字面量中的页面方法名做最小转义，避免特殊字符影响门禁表达式。 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 检查原生页面的模板、样式和跳转边界。
 *
 * 微信开发者工具对 WXML 事件、页面路径和本地资源的校验并不总是在构建阶段
 * 给出阻断错误：页面可能成功编译，但真机点击后才发现方法不存在、目标页面
 * 未注册，或 WXSS 尝试读取本地图片。把这些检查放在源码到 dist 的必经构建
 * 阶段，可以让“能上传”与“运行时入口完整”保持同一条证据链。
 */
async function validatePageRuntimeBoundaries(
	pagePaths: readonly string[],
): Promise<void> {
	const registeredPages = new Set(pagePaths);
	const bindingPattern = /(?:bind|catch)[a-z]+="([A-Za-z_$][\w$]*)"/g;
	const localAssetPattern = /\/assets\/[A-Za-z0-9._/-]+/g;
	const pageNavigationPattern = /url:\s*["'](\/pages\/[^"']+)["']/g;

	for (const pagePath of pagePaths) {
		const templatePath = join(source, `${pagePath}.wxml`);
		const stylePath = join(source, `${pagePath}.wxss`);
		const scriptPath = join(source, `${pagePath}.ts`);
		const [template, style, script] = await Promise.all([
			Bun.file(templatePath).text(),
			Bun.file(stylePath).text(),
			Bun.file(scriptPath).text(),
		]);

		if (/url\s*\(\s*["']?\/assets\//.test(style)) {
			throw new Error(
				`${pagePath}.wxss cannot load local assets with background-image; use WXML image or base64`,
			);
		}

		const assetReferences = new Set([
			...(template.match(localAssetPattern) ?? []),
			...(style.match(localAssetPattern) ?? []),
		]);
		for (const assetReference of assetReferences) {
			await access(join(source, assetReference.replace(/^\//, "")));
		}

		const pageEntryIndex = script.indexOf("Page<");
		const usesClinicalSurfaceFactory = script.includes(
			"registerClinicalSurfacePage(",
		);
		const usesPatientContractSurfaceFactory = script.includes(
			"registerPatientContractSurfacePage(",
		);
		const usesClinicalContentSurfaceFactory = script.includes(
			"registerClinicalContentSurfacePage(",
		);
		const usesExternalEntrySurfaceFactory = script.includes(
			"registerExternalEntrySurfacePage(",
		);
		const usesProviderEntrySurfaceFactory = script.includes(
			"registerProviderEntrySurfacePage(",
		);
		if (
			pageEntryIndex < 0 &&
			!usesClinicalSurfaceFactory &&
			!usesPatientContractSurfaceFactory &&
			!usesClinicalContentSurfaceFactory &&
			!usesExternalEntrySurfaceFactory &&
			!usesProviderEntrySurfaceFactory
		) {
			throw new Error(`${pagePath}.ts must contain a Page implementation`);
		}
		/**
		 * 页面外壳入口只声明自己的 FeatureKey，实际 Page 方法集中在共享
		 * service 中。这里把对应工厂源码纳入同一条静态事件门禁，既允许复用，
		 * 又不放松 WXML 方法检查。
		 */
		const sharedPageFactory = usesClinicalSurfaceFactory
			? await Bun.file(
					join(source, "services", "clinical-entry-surface.ts"),
				).text()
			: usesPatientContractSurfaceFactory
				? await Bun.file(
						join(source, "services", "patient-contract-surface.ts"),
					).text()
				: usesClinicalContentSurfaceFactory
					? await Bun.file(
							join(source, "services", "clinical-content-surface.ts"),
						).text()
					: usesExternalEntrySurfaceFactory
						? await Bun.file(
								join(source, "services", "external-entry-surface.ts"),
							).text()
						: usesProviderEntrySurfaceFactory
							? await Bun.file(
									join(source, "services", "provider-entry-surface.ts"),
								).text()
							: "";
		const pageImplementation =
			usesClinicalSurfaceFactory ||
			usesPatientContractSurfaceFactory ||
			usesClinicalContentSurfaceFactory ||
			usesExternalEntrySurfaceFactory ||
			usesProviderEntrySurfaceFactory
				? `${script}\n${sharedPageFactory}`
				: script.slice(pageEntryIndex);
		for (const match of template.matchAll(bindingPattern)) {
			const handler = match[1];
			if (!handler) continue;
			const handlerPattern = new RegExp(
				`(?:^|\\n)\\s*${escapeRegExp(handler)}\\s*(?::\\s*)?\\(`,
			);
			if (!handlerPattern.test(pageImplementation)) {
				throw new Error(
					`${pagePath}.wxml binds ${handler}, but the Page implementation does not define it`,
				);
			}
		}

		for (const match of script.matchAll(pageNavigationPattern)) {
			const target = match[1]?.replace(/^\//, "");
			if (target && !registeredPages.has(target)) {
				throw new Error(
					`${pagePath}.ts navigates to unregistered mini-program page ${target}`,
				);
			}
		}
	}
}

for (const pagePath of appPagePaths) {
	for (const extension of [".json", ".wxml", ".wxss", ".ts"]) {
		await access(join(source, `${pagePath}${extension}`));
	}
}

await validatePageRuntimeBoundaries(appPagePaths);

for (const file of [...requiredStaticFiles, ...requiredTypeScriptFiles]) {
	await access(join(source, file));
}

for (const directory of requiredAssetDirectories) {
	await access(join(source, directory));
}

/** 只把非 TypeScript 资源复制到运行目录，避免把源码配置副本带入上传包。 */
async function copyStaticFiles(
	currentSource: string,
	targetRuntime: string,
): Promise<void> {
	const entries = await readdir(currentSource, { withFileTypes: true });
	for (const entry of entries) {
		if (
			entry.name === "project.config.json" ||
			entry.name === "project.private.config.json"
		)
			continue;

		const sourcePath = join(currentSource, entry.name);
		const relativePath = relative(source, sourcePath);
		const targetPath = join(targetRuntime, relativePath);
		if (entry.isDirectory()) {
			await copyStaticFiles(sourcePath, targetRuntime);
			continue;
		}
		if (extname(entry.name) === ".ts") continue;
		await mkdir(dirname(targetPath), { recursive: true });
		await cp(sourcePath, targetPath);
	}
}

/**
 * 使用项目锁定的 TypeScript 编译器输出 CommonJS 页面脚本到 staging；staging
 * 放在 miniprogram 项目根目录之外，避免微信开发者工具把临时文件当成页面输入。
 * 小程序只消费已经完整发布的 dist，src 仍是唯一业务源码；不能在这里清空 live
 * dist，否则开发者工具监听到整目录删除时会出现页面 404。
 */
const stagingRuntime = await mkdtemp(
	join(dirname(root), ".hospital-miniprogram-staging-"),
);
// 该目录位于小程序项目根之外，不会被微信工具当作运行包；只有完整构建
// 校验通过、但 `dist/` 被工具锁定时，才会短暂保留它作为待发布候选。
const pendingRuntime = getMiniProgramPendingRuntimePath(root);
try {
	/**
	 * tsconfig.build.json 会继续检查同一份 src 类型树，但明确排除 *.test.ts 和
	 * *.spec.ts。测试文件属于开发验证输入，不是微信运行时模块；若把它们发进 dist，
	 * 不仅会增大上传包，还会让测试提交伪装成页面运行包变化。
	 */
	const compile = Bun.spawnSync(
		["pnpm", "exec", "tsc", "-p", buildConfigPath, "--outDir", stagingRuntime],
		{
			cwd: root,
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (!compile.success) {
		throw new Error(
			`Mini program TypeScript emit failed with code ${compile.exitCode}`,
		);
	}

	/**
	 * app.js 是微信小程序的全局脚本，不是可由 CommonJS loader 执行的业务模块。
	 * App.onLaunch 需要在页面创建前启动全局资料仓库，因此这里对 app.ts 单独做
	 * IIFE bundle；页面业务模块仍按依赖图使用 CommonJS 输出，由微信的页面模块
	 * 加载器执行。若只沿用 tsc 的 Node16 输出，App 的 import 会变成 require，
	 * 真机 appService 会在首帧前因 `require is not defined` 失败。
	 */
	const appRuntimePath = join(stagingRuntime, "app.js");
	const appBundle = await Bun.build({
		entrypoints: [join(source, "app.ts")],
		format: "iife",
		target: "browser",
		minify: false,
		sourcemap: "none",
		// Bun 1.4 的构建类型通过 outdir 写入 staging；staging 尚未对微信工具
		// 暴露，且最终仍由下面的完整校验和原子发布接管，不会污染 live dist。
		outdir: stagingRuntime,
	});
	if (!appBundle.success) {
		throw new Error(
			`Mini program app.ts global-script bundle failed: ${appBundle.logs.map((log) => log.message).join("; ")}`,
		);
	}
	const appBundleOutput = appBundle.outputs[0];
	if (!appBundleOutput) {
		throw new Error("Mini program app.ts bundle produced no app.js output");
	}
	await Bun.write(appRuntimePath, await appBundleOutput.text());
	const normalizedAppRuntime = await Bun.file(appRuntimePath).text();
	if (
		/Object\.defineProperty\(exports/.test(normalizedAppRuntime) ||
		/\b(?:exports|module|require)\s*[.(=]/.test(normalizedAppRuntime)
	) {
		throw new Error(
			"Mini program app.js must remain a global script without CommonJS bootstrap",
		);
	}
	await copyStaticFiles(source, stagingRuntime);

	/**
	 * 运行包必须可以作为一个“只包含 dist 内容”的独立微信工程打开。
	 *
	 * 之前只在父目录放 `project.config.json`，再通过 `miniprogramRoot=dist/`
	 * 指向运行目录；但开发者工具仍会以父目录为 watcher 根，扫描旁边的
	 * `src/` 和 `scripts/`。当历史自定义底栏或隐式 TypeScript 输出残留时，
	 * 它们就可能重新进入增量模块图，导致底栏闪动、selected 图标丢失和
	 * 页面脚本 404。把配置随完整运行包一起生成，真机工程直接打开 `dist/`
	 * 后，运行层与 TypeScript 源码在文件系统上彻底隔离。
	 *
	 * 这里不复制开发者工具的 private 配置，也不把源码路径写入运行包；
	 * `dist/project.private.config.json` 由工具按本机状态自行生成，并且
	 * 因为 dist 已被 Git 忽略，不会污染提交。
	 */
	const runtimeProjectConfig = {
		description: "高平医院原生微信小程序运行包",
		compileType: "miniprogram",
		miniprogramRoot: "./",
		projectname: `${String(projectConfig.projectname ?? "hospital-platform")}-runtime`,
		appid: String(projectConfig.appid ?? ""),
		setting: {
			urlCheck: true,
			es6: true,
			enhance: true,
			postcss: true,
			minified: true,
			minifyWXML: true,
			minifyWXSS: true,
			uploadWithSourceMap: true,
			compileHotReLoad: false,
			ignoreDevUnusedFiles: false,
		},
		packOptions: {
			ignore: [],
			include: [],
		},
	};
	if (runtimeProjectConfig.appid.length === 0) {
		throw new Error(
			"Mini program runtime project.config.json requires a non-empty appid",
		);
	}
	await Bun.write(
		join(stagingRuntime, "project.config.json"),
		`${JSON.stringify(runtimeProjectConfig, null, 2)}\n`,
	);

	/**
	 * 测试源码已经在 tsconfig.build.json 排除，但发布目录还必须再做一次
	 * 文件级门禁。这样即使未来有人新增静态复制逻辑、误把历史 dist 内容
	 * 带入 staging，测试脚本也不会被微信开发者工具当成运行时模块加载。
	 * 真机报错里的 `dist/services/*.test.js` 就属于必须在发布前阻断的形态。
	 */
	const stagingFiles = await listRuntimeFiles(stagingRuntime);
	const forbiddenTestRuntimeFiles = stagingFiles.filter((file) =>
		/(?:\.test|\.spec)\.js$/u.test(file),
	);
	if (forbiddenTestRuntimeFiles.length > 0) {
		throw new Error(
			`Mini program runtime must not contain test scripts: ${forbiddenTestRuntimeFiles.join(", ")}`,
		);
	}

	const missingRelativeImports =
		await findMissingRelativeImports(stagingRuntime);
	if (missingRelativeImports.length > 0) {
		throw new Error(
			`Mini program runtime contains missing relative imports: ${missingRelativeImports.join(", ")}`,
		);
	}

	const forbiddenWorkspaceImports =
		await findForbiddenWorkspaceImports(stagingRuntime);
	if (forbiddenWorkspaceImports.length > 0) {
		throw new Error(
			`Mini program runtime must not import pnpm workspace modules: ${forbiddenWorkspaceImports.join(", ")}`,
		);
	}

	/**
	 * 这是运行包的来源指纹，不携带环境变量、会话、患者或服务商数据。
	 * 开发者工具导入 dist/ 后，验收人员可以直接将 sourceRevision 与候选提交核对，
	 * 从而区分“代码已修复但工具仍在运行旧缓存”和“当前候选本身仍有问题”。
	 */
	const buildInfo: MiniProgramBuildInfo = {
		schemaVersion: 1,
		sourceRevision: resolveSourceRevision(),
		pageCount: appPagePaths.length,
		generatedAt: new Date().toISOString(),
	};
	/**
	 * 把来源指纹写入 app.js 的启动日志。占位符和 Git 提交号长度相同，
	 * 不改变生成脚本的行偏移；真机控制台可据此确认是否运行了本次候选。
	 */
	const runtimeAppPath = join(stagingRuntime, "app.js");
	const runtimeApp = await Bun.file(runtimeAppPath).text();
	const buildRevisionPlaceholder = "0000000000000000000000000000000000000000";
	if (!runtimeApp.includes(buildRevisionPlaceholder)) {
		throw new Error(
			"Mini program app.js is missing the build revision placeholder",
		);
	}
	await Bun.write(
		runtimeAppPath,
		runtimeApp.replaceAll(buildRevisionPlaceholder, buildInfo.sourceRevision),
	);
	await Bun.write(
		join(stagingRuntime, "build-info.json"),
		`${JSON.stringify(buildInfo, null, 2)}\n`,
	);

	for (const file of requiredStaticFiles) {
		await access(join(stagingRuntime, file));
	}
	for (const file of requiredTypeScriptFiles) {
		await access(join(stagingRuntime, file.replace(/\.ts$/, ".js")));
	}
	for (const pagePath of appPagePaths) {
		await access(join(stagingRuntime, `${pagePath}.js`));
	}

	await publishMiniProgramRuntime(stagingRuntime, runtime);

	console.log(
		`Native tabBar mini program runtime published at ${runtime}; revision=${buildInfo.sourceRevision.slice(0, 7)}; ${buildInfo.pageCount} app.json page scripts are present`,
	);
} catch (error) {
	if (isMiniProgramRuntimeLockError(error)) {
		// 此时 staging 已完成 TypeScript、静态文件、页面入口、相对依赖、
		// workspace 引用和来源指纹校验。保留它可以让工具关闭后直接原子
		// 发布，避免反复编译期间继续触发旧页面/新页面混用。
		try {
			await mkdir(dirname(pendingRuntime), { recursive: true });
			await rm(pendingRuntime, { recursive: true, force: true });
			await rename(stagingRuntime, pendingRuntime);
		} catch (preserveError) {
			await rm(stagingRuntime, { recursive: true, force: true });
			throw new Error(
				`Mini program dist/ is locked and the validated pending runtime could not be preserved: ${String(preserveError)}`,
				{ cause: error },
			);
		}
		throw createMiniProgramRuntimeLockError(pendingRuntime, error);
	}
	// 发布前的任意非锁定编译/校验失败都只清理 staging；live dist 保留上一份
	// 完整运行包，让开发者工具继续使用旧候选，而不是暴露页面 404。
	await rm(stagingRuntime, { recursive: true, force: true });
	throw error;
}
