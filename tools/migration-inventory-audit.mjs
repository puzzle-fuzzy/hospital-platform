import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 原生小程序迁移台账审计。
 *
 * app.json 是微信运行时真正读取的页面注册表，不能只靠人工记忆维护迁移状态。
 * 本审计只做静态一致性检查：它不调用 API、不读取生产数据、不执行 migration，
 * 也不把“页面存在”解释成“业务已经真实验收”。真实 provider、生产、公网和真机
 * 证据仍必须按对应 release 文档分别保存。
 */

const repositoryRoot = new URL("../", import.meta.url);
const readText = (relativePath) =>
	Bun.file(new URL(relativePath, repositoryRoot)).text();

const appConfig = JSON.parse(await readText("apps/miniprogram/src/app.json"));
const pagePaths = appConfig.pages;
if (
	!Array.isArray(pagePaths) ||
	pagePaths.length === 0 ||
	pagePaths.some((page) => typeof page !== "string" || page.length === 0)
) {
	throw new Error(
		"apps/miniprogram/src/app.json must contain non-empty page paths",
	);
}

const ledger = await readText("docs/migration/native-page-migration-status.md");
const missingPages = pagePaths.filter(
	(pagePath) => !ledger.includes(`| \`${pagePath}\` |`),
);

if (missingPages.length > 0) {
	console.error("Native page migration ledger is missing:");
	for (const pagePath of missingPages) console.error(`- ${pagePath}`);
	process.exitCode = 1;
} else {
	console.log(
		`Native page migration ledger passed: ${pagePaths.length} registered page(s) documented`,
	);
}

/**
 * 反向检查台账中的路径是否仍然注册，防止删除页面后遗留一行“已迁移”状态，
 * 让路线图继续暗示一个实际上不存在的入口。只读取台账中的机器可识别表格行。
 */
const ledgerPagePaths = [...ledger.matchAll(/^\| `([^`]+)` \|/gmu)]
	.map((match) => match[1])
	.filter((pagePath) => pagePath.startsWith("pages/"));
const stalePages = ledgerPagePaths.filter(
	(pagePath) => !pagePaths.includes(pagePath),
);
if (stalePages.length > 0) {
	console.error("Native page migration ledger contains unregistered page(s):");
	for (const pagePath of stalePages) console.error(`- ${pagePath}`);
	process.exitCode = 1;
}

if (missingPages.length === 0 && stalePages.length === 0) {
	console.log(
		"Native page migration ledger has no stale registered-page entries",
	);
}

/**
 * 旧端页面清单是迁移范围的事实输入。旧仓库通常与新仓库并列存在，
 * 但不会被提交到新仓库，因此这里使用可选的外部根目录做交叉核对：
 * - 当前机器存在旧仓库时，实际 `.vue` 文件必须全部出现在迁移矩阵；
 * - CI 或新会话没有旧仓库时，只跳过这项外部检查，不伪造“已核对”。
 */
const legacyRoot =
	process.env.LEGACY_HOSPITAL_ROOT?.trim() || "G:\\fuck\\hospital";
const legacySourceRoot = join(legacyRoot, "hospital-app", "src");
const legacySentinel = join(legacySourceRoot, "pages", "index", "index.vue");

if (!(await Bun.file(legacySentinel).exists())) {
	console.log(
		`Legacy page inventory skipped: old repository is not available at ${legacyRoot}`,
	);
} else {
	const legacyMatrix = await readText("docs/migration/legacy-page-matrix.md");
	const documentedLegacyPages = new Set();
	for (const line of legacyMatrix.split("\n")) {
		const row = line.match(/^\| `([^`]+\/)` \| (.+?) \|/u);
		if (!row) continue;
		for (const pageMatch of row[2].matchAll(/`([^`]+\.vue)`/gu)) {
			documentedLegacyPages.add(`${row[1]}${pageMatch[1]}`);
		}
	}

	const actualLegacyPages = new Set();
	for (const pattern of ["pages/**/*.vue", "pagesB/**/*.vue"]) {
		const glob = new Bun.Glob(pattern);
		for await (const pagePath of glob.scan({
			cwd: legacySourceRoot,
			onlyFiles: true,
		})) {
			actualLegacyPages.add(pagePath.replaceAll("\\", "/"));
		}
	}

	const undocumentedLegacyPages = [...actualLegacyPages]
		.filter((pagePath) => !documentedLegacyPages.has(pagePath))
		.sort();
	const staleLegacyPages = [...documentedLegacyPages]
		.filter((pagePath) => !actualLegacyPages.has(pagePath))
		.sort();

	if (undocumentedLegacyPages.length > 0 || staleLegacyPages.length > 0) {
		if (undocumentedLegacyPages.length > 0) {
			console.error("Legacy page matrix is missing actual page(s):");
			for (const pagePath of undocumentedLegacyPages)
				console.error(`- ${pagePath}`);
		}
		if (staleLegacyPages.length > 0) {
			console.error("Legacy page matrix contains stale page(s):");
			for (const pagePath of staleLegacyPages) console.error(`- ${pagePath}`);
		}
		process.exitCode = 1;
	} else {
		console.log(
			`Legacy page inventory passed: ${actualLegacyPages.size} old page(s) match the migration matrix`,
		);
	}

	/**
	 * 页面矩阵解决“文档有没有登记”，原生台账解决“每个旧页面实际落到哪里”。
	 * 两者必须同时通过：只登记 Markdown 仍可能漏掉状态页、排除项或真实原生
	 * 路径；只写 TypeScript 台账又可能与旧仓库新增页面脱节。此处只读导入
	 * 新端清单，不执行页面、接口或数据库迁移。
	 */
	const nativeCatalog = await import(
		"../apps/miniprogram/src/services/legacy-page-catalog.ts"
	);
	const catalogPages = new Set(
		nativeCatalog.LEGACY_PAGE_MIGRATION_CATALOG.map(
			(entry) => entry.legacyPath,
		),
	);
	const missingCatalogPages = [...actualLegacyPages]
		.filter((pagePath) => !catalogPages.has(pagePath))
		.sort();
	const staleCatalogPages = [...catalogPages]
		.filter((pagePath) => !actualLegacyPages.has(pagePath))
		.sort();
	if (missingCatalogPages.length > 0 || staleCatalogPages.length > 0) {
		if (missingCatalogPages.length > 0) {
			console.error("Native legacy page catalog is missing actual page(s):");
			for (const pagePath of missingCatalogPages)
				console.error(`- ${pagePath}`);
		}
		if (staleCatalogPages.length > 0) {
			console.error("Native legacy page catalog contains stale page(s):");
			for (const pagePath of staleCatalogPages) console.error(`- ${pagePath}`);
		}
		process.exitCode = 1;
	} else {
		const statusSummary = Object.entries(
			Object.groupBy(
				nativeCatalog.LEGACY_PAGE_MIGRATION_CATALOG,
				(entry) => entry.status,
			),
		)
			.map(([status, entries]) => `${status}=${entries?.length ?? 0}`)
			.join(", ");
		const domainSummary = nativeCatalog.LEGACY_PAGE_DOMAIN_SUMMARY.map(
			(summary) => `${summary.domain}=${summary.total}`,
		).join(", ");
		console.log(
			`Native legacy page catalog passed: ${catalogPages.size} page(s), ${statusSummary}`,
		);
		console.log(`Native legacy page domain summary: ${domainSummary}`);
	}
}

/**
 * 旧 Python 接口数量审计只用于锁定“迁移范围”，不是路由语义验收。
 *
 * 旧服务中存在少量源码文件，但它们没有被 include_router 挂载；如果把源码扫描总数
 * 直接当成线上可用路由数量，就会把孤立实现误判成患者端迁移目标。接口台账通过机器可读
 * 注释声明这些未挂载文件，审计再用相同规则计算各模块的已挂载静态数量。
 */
const legacyApiRoot = join(legacyRoot, "app", "api", "v1");
const legacyApiSentinel = join(legacyApiRoot, "__init__.py");
if (!(await Bun.file(legacyApiSentinel).exists())) {
	console.log(
		`Legacy API inventory skipped: old API repository is not available at ${legacyApiRoot}`,
	);
} else {
	const legacyApiInventory = await readText(
		"docs/migration/legacy-api-endpoint-inventory.md",
	);
	const expectedModuleCounts = new Map();
	for (const match of legacyApiInventory.matchAll(
		/^\| `(module_[^`]+)` \| (\d+) \|/gmu,
	)) {
		expectedModuleCounts.set(match[1], Number(match[2]));
	}
	const expectedMountedTotal = Number(
		legacyApiInventory.match(
			/^\| \*\*已挂载静态合计\*\* \| \*\*(\d+)\*\*/mu,
		)?.[1],
	);
	const unmountedRouteFiles = [];
	for (const match of legacyApiInventory.matchAll(
		/<!-- migration-audit: unmounted-route-file=([^\s]+) routes=(\d+) -->/gu,
	)) {
		unmountedRouteFiles.push({
			path: match[1],
			routes: Number(match[2]),
		});
	}

	const expectedModules = [
		"module_system",
		"module_monitor",
		"module_application",
		"module_common",
		"module_convenience",
		"module_intelligent",
		"module_knowledge",
	];
	const missingExpectedModules = expectedModules.filter(
		(moduleName) => !expectedModuleCounts.has(moduleName),
	);
	if (
		missingExpectedModules.length > 0 ||
		!Number.isInteger(expectedMountedTotal) ||
		unmountedRouteFiles.length === 0
	) {
		console.error(
			"Legacy API inventory document is missing machine-readable scope metadata",
		);
		for (const moduleName of missingExpectedModules) {
			console.error(`- missing module count: ${moduleName}`);
		}
		if (!Number.isInteger(expectedMountedTotal))
			console.error("- missing mounted route total");
		if (unmountedRouteFiles.length === 0)
			console.error("- missing unmounted route file declaration");
		process.exitCode = 1;
	} else {
		const routePattern =
			/@[A-Za-z_][A-Za-z0-9_]*\.(?:get|post|put|delete|patch)\(/gu;
		const unmountedByPath = new Map(
			unmountedRouteFiles.map((entry) => [entry.path, entry.routes]),
		);
		const actualModuleCounts = new Map(
			expectedModules.map((moduleName) => [moduleName, 0]),
		);
		const actualUnmountedCounts = new Map();

		for (const moduleName of expectedModules) {
			const glob = new Bun.Glob(`${moduleName}/**/*.py`);
			for await (const relativePath of glob.scan({
				cwd: legacyApiRoot,
				onlyFiles: true,
			})) {
				const normalizedPath = relativePath.replaceAll("\\", "/");
				const source = await Bun.file(join(legacyApiRoot, relativePath)).text();
				const routeCount = [...source.matchAll(routePattern)].length;
				const declaredUnmountedCount = unmountedByPath.get(normalizedPath);
				if (declaredUnmountedCount !== undefined) {
					actualUnmountedCounts.set(normalizedPath, routeCount);
					continue;
				}
				actualModuleCounts.set(
					moduleName,
					(actualModuleCounts.get(moduleName) ?? 0) + routeCount,
				);
			}
		}

		const mismatches = [];
		for (const moduleName of expectedModules) {
			const actual = actualModuleCounts.get(moduleName);
			const expected = expectedModuleCounts.get(moduleName);
			if (actual !== expected)
				mismatches.push(
					`${moduleName}: expected ${expected}, actual ${actual}`,
				);
		}
		const actualMountedTotal = [...actualModuleCounts.values()].reduce(
			(total, count) => total + count,
			0,
		);
		if (actualMountedTotal !== expectedMountedTotal) {
			mismatches.push(
				`mounted total: expected ${expectedMountedTotal}, actual ${actualMountedTotal}`,
			);
		}
		for (const [relativePath, expected] of unmountedByPath) {
			const actual = actualUnmountedCounts.get(relativePath);
			if (actual === undefined)
				mismatches.push(`unmounted file is missing: ${relativePath}`);
			else if (actual !== expected)
				mismatches.push(
					`${relativePath}: expected ${expected} route(s), actual ${actual}`,
				);
		}

		if (mismatches.length > 0) {
			console.error("Legacy API inventory mismatch:");
			for (const mismatch of mismatches) console.error(`- ${mismatch}`);
			process.exitCode = 1;
		} else {
			console.log(
				`Legacy API inventory passed: ${actualMountedTotal} mounted route(s), ${unmountedRouteFiles.length} unmounted route file(s) documented`,
			);
		}
	}
}

/**
 * 旧小程序的非页面文件也属于迁移范围事实：请求封装、状态仓储、复用组件、
 * 静态配置和资源一旦漏盘，页面台账仍可能“通过”但业务行为已经偏移。这里
 * 只核对文件数量，不把文件存在解释成逻辑已迁移；具体安全边界和业务状态仍
 * 由 legacy-client-infrastructure-boundaries.md 维护。
 */
const legacyClientSentinel = join(legacySourceRoot, "api", "http.ts");
if (!(await Bun.file(legacyClientSentinel).exists())) {
	console.log(
		`Legacy client infrastructure inventory skipped: old client is not available at ${legacySourceRoot}`,
	);
} else {
	const legacyClientInventory = await readText(
		"docs/migration/legacy-client-infrastructure-boundaries.md",
	);
	const expectedCategories = [
		"api",
		"stores",
		"utils",
		"components",
		"jsonData",
		"static",
	];
	const expectedCounts = new Map();
	for (const match of legacyClientInventory.matchAll(
		/<!-- migration-audit: legacy-client-category=([^\s]+) files=(\d+) -->/gu,
	)) {
		expectedCounts.set(match[1], Number(match[2]));
	}
	const missingCategories = expectedCategories.filter(
		(category) => !expectedCounts.has(category),
	);
	if (missingCategories.length > 0) {
		console.error("Legacy client infrastructure inventory is incomplete:");
		for (const category of missingCategories) {
			console.error(`- missing category count: ${category}`);
		}
		process.exitCode = 1;
	} else {
		const sourceExtensions = new Set([
			".ts",
			".js",
			".vue",
			".json",
			".scss",
			".css",
			".png",
			".jpg",
			".jpeg",
			".svg",
			".gif",
			".webp",
		]);
		const actualCounts = new Map();
		for (const category of expectedCategories) {
			let count = 0;
			const glob = new Bun.Glob(`${category}/**/*`);
			for await (const relativePath of glob.scan({
				cwd: legacySourceRoot,
				onlyFiles: true,
			})) {
				const extension = relativePath.slice(relativePath.lastIndexOf("."));
				if (sourceExtensions.has(extension.toLowerCase())) count += 1;
			}
			actualCounts.set(category, count);
		}

		const mismatches = expectedCategories
			.filter(
				(category) =>
					actualCounts.get(category) !== expectedCounts.get(category),
			)
			.map(
				(category) =>
					`${category}: expected ${expectedCounts.get(category)}, actual ${actualCounts.get(category)}`,
			);
		if (mismatches.length > 0) {
			console.error("Legacy client infrastructure inventory mismatch:");
			for (const mismatch of mismatches) console.error(`- ${mismatch}`);
			process.exitCode = 1;
		} else {
			console.log(
				`Legacy client infrastructure inventory passed: ${expectedCategories.map((category) => `${category}=${actualCounts.get(category)}`).join(", ")}`,
			);
		}
	}
}

/**
 * 旧业务模块中的 endpoint 字面量必须在旧接口台账中有出处。动态 path 参数和
 * query 参数在比对时统一成占位符，只检查“这条调用事实是否被登记”，不把它
 * 直接变成新端可调用接口；新端是否迁移仍以 contract、adapter 和真实证据为准。
 */
const legacyClientApiModulesRoot = join(legacySourceRoot, "api", "modules");
const legacyClientApiModulesSentinel = join(
	legacyClientApiModulesRoot,
	"ZY.ts",
);
if (!(await Bun.file(legacyClientApiModulesSentinel).exists())) {
	console.log(
		`Legacy client endpoint inventory skipped: old API modules are not available at ${legacyClientApiModulesRoot}`,
	);
} else {
	const endpointPattern =
		/["'`](\/(?:api|common|convenience|intelligent|knowledge|msun|system|shift-scheduling|monitor|application|webSocket)[^"'`\s]*)["'`]/gu;
	const normalizeEndpoint = (value) =>
		value.replace(/\$\{[^}]+\}/gu, "{param}").replace(/\?.*$/u, "");
	const inventoryText = await readText(
		"docs/migration/legacy-api-endpoint-inventory.md",
	);
	const normalizedInventoryText = inventoryText
		.replace(/\{[^}\r\n]+\}/gu, "{param}")
		.replace(/\?[A-Za-z0-9_=&{}.-]+/gu, "?{query}");
	const actualEndpoints = new Set();
	const glob = new Bun.Glob("api/modules/*.ts");
	for await (const relativePath of glob.scan({
		cwd: legacySourceRoot,
		onlyFiles: true,
	})) {
		const source = await Bun.file(join(legacySourceRoot, relativePath)).text();
		for (const match of source.matchAll(endpointPattern)) {
			actualEndpoints.add(normalizeEndpoint(match[1]));
		}
	}
	const undocumentedEndpoints = [...actualEndpoints]
		.filter((endpoint) => !normalizedInventoryText.includes(endpoint))
		.sort();
	if (undocumentedEndpoints.length > 0) {
		console.error("Legacy client endpoint inventory is missing endpoint(s):");
		for (const endpoint of undocumentedEndpoints)
			console.error(`- ${endpoint}`);
		process.exitCode = 1;
	} else {
		console.log(
			`Legacy client endpoint inventory passed: ${actualEndpoints.size} endpoint literal(s) documented`,
		);
	}
}

/**
 * 页面和普通 endpoint 台账不能覆盖微信平台级入口：WebSocket、跳转其他小程序、
 * web-view、支付调起、二维码和医保回跳都可能没有独立的 HTTP route。这里按源码文件
 * 级别登记行为指示，防止后续新增/删除旧入口时台账静默漂移；注释或 manifest 命中也
 * 只表示“需要人工确认”，绝不表示该业务已经迁移或已经真实验收。
 */
const legacyBehaviorSentinel = join(legacySourceRoot, "api", "ws.ts");
if (!(await Bun.file(legacyBehaviorSentinel).exists())) {
	console.log(
		"Legacy client behavior inventory skipped: old client is not available at " +
			legacySourceRoot,
	);
} else {
	const legacyBehaviorInventory = await readText(
		"docs/migration/legacy-client-infrastructure-boundaries.md",
	);
	const behaviorRules = [
		{
			name: "websocket",
			pattern: /uni\.connectSocket|wx\.connectSocket|new\s+WebSocket/u,
		},
		{
			name: "mini-program-navigation",
			pattern: /navigateToMiniProgram/u,
		},
		{
			name: "web-view",
			pattern: /<web-view|<webview|webViewUrl/u,
		},
		{
			name: "payment-invocation",
			pattern: /(?:uni|wx)\.requestPayment|requestPayment\s*\(/u,
		},
		{
			name: "qr-and-official-account",
			pattern: /二维码|QRCode|qrCode|canvasToTempFilePath|scanCode/u,
		},
		{
			name: "insurance-callback",
			pattern: /authCode|referrerInfo|insuranceAuth/u,
		},
	];
	const expectedBehaviorCounts = new Map();
	for (const match of legacyBehaviorInventory.matchAll(
		/<!-- migration-audit: legacy-client-behavior=([^\s]+) files=(\d+) -->/gu,
	)) {
		expectedBehaviorCounts.set(match[1], Number(match[2]));
	}
	const missingBehaviors = behaviorRules
		.map(({ name }) => name)
		.filter((name) => !expectedBehaviorCounts.has(name));
	if (missingBehaviors.length > 0) {
		console.error("Legacy client behavior inventory is incomplete:");
		for (const name of missingBehaviors)
			console.error(`- missing behavior count: ${name}`);
		process.exitCode = 1;
	} else {
		const sourceExtensions = new Set([".ts", ".js", ".vue", ".json"]);
		const actualBehaviorFiles = new Map(
			behaviorRules.map(({ name }) => [name, 0]),
		);
		for await (const relativePath of new Bun.Glob("**/*").scan({
			cwd: legacySourceRoot,
			onlyFiles: true,
		})) {
			const extension = relativePath.slice(relativePath.lastIndexOf("."));
			if (!sourceExtensions.has(extension.toLowerCase())) continue;
			const source = await Bun.file(
				join(legacySourceRoot, relativePath),
			).text();
			for (const { name, pattern } of behaviorRules) {
				if (pattern.test(source)) {
					actualBehaviorFiles.set(
						name,
						(actualBehaviorFiles.get(name) ?? 0) + 1,
					);
				}
			}
		}
		const mismatches = behaviorRules
			.map(({ name }) => name)
			.filter(
				(name) =>
					actualBehaviorFiles.get(name) !== expectedBehaviorCounts.get(name),
			)
			.map(
				(name) =>
					name +
					": expected " +
					expectedBehaviorCounts.get(name) +
					", actual " +
					actualBehaviorFiles.get(name),
			);
		if (mismatches.length > 0) {
			console.error("Legacy client behavior inventory mismatch:");
			for (const mismatch of mismatches) console.error(`- ${mismatch}`);
			process.exitCode = 1;
		} else {
			console.log(
				"Legacy client behavior inventory passed: " +
					behaviorRules
						.map(({ name }) => `${name}=${actualBehaviorFiles.get(name)}`)
						.join(", "),
			);
		}
	}
}

// 保留仓库根目录引用，避免从仓库外运行时被当前工作目录影响。
void fileURLToPath(repositoryRoot);
