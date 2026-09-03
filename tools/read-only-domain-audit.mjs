import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { READ_ONLY_DOMAIN_CATALOG } from "./read-only-domain-catalog.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const REQUIRED_SEMANTIC_STATES = [
	"requesting",
	"success-non-empty",
	"success-empty",
	"unauthorized",
	"invalid-input",
	"temporary-failure",
	"contract-invalid",
];

async function readRepositoryFile(relativePath) {
	return Bun.file(join(repositoryRoot, relativePath)).text();
}

async function fileExists(relativePath) {
	return Bun.file(join(repositoryRoot, relativePath)).exists();
}

/**
 * 校验“低风险域闭环”而不是只校验一个列表页。
 * 页面存在只能说明入口不再 404；真正的迁移闭环还必须能追到 API 路由、
 * service/domain/adapter 实现、日志事件以及对应的契约/验收文档。
 */
export async function auditReadOnlyDomains() {
	const failures = [];
	const seenDomainIds = new Set();
	const operationClasses = new Set([
		"read-only",
		"read-model-sync",
		"read-write",
	]);
	const appJson = JSON.parse(
		await readRepositoryFile("apps/miniprogram/src/app.json"),
	);
	const registeredPages = new Set(appJson.pages ?? []);
	const publicApiDocumentation = await readRepositoryFile(
		"docs/公共API-v2.md",
	);
	const errorHandlerSource = await readRepositoryFile(
		"apps/api/src/plugins/error-handler.ts",
	);
	const clientErrorSource = await readRepositoryFile(
		"apps/miniprogram/src/services/api-client.ts",
	);
	const loggingDocumentation = await readRepositoryFile("docs/日志规范.md");

	for (const domain of READ_ONLY_DOMAIN_CATALOG) {
		if (seenDomainIds.has(domain.id)) {
			failures.push(`重复的只读业务域 id：${domain.id}`);
		}
		seenDomainIds.add(domain.id);
		if (!operationClasses.has(domain.operationClass)) {
			failures.push(`${domain.id}: 未知操作边界分类：${domain.operationClass}`);
		}
		if (
			domain.id === "patients" &&
			domain.operationClass !== "read-model-sync"
		) {
			failures.push("patients: 患者目录同步必须标记为 read-model-sync");
		}
		if (
			domain.id === "user-profile" &&
			domain.operationClass !== "read-write"
		) {
			failures.push("user-profile: 普通资料 PUT 必须标记为 read-write");
		}

		const semanticStates = new Set(domain.semanticStates ?? []);
		for (const state of REQUIRED_SEMANTIC_STATES) {
			if (!semanticStates.has(state)) {
				failures.push(`${domain.id}: 缺少业务语义状态：${state}`);
			}
		}
		if (domain.emptyResult?.state !== "success-empty") {
			failures.push(`${domain.id}: 空结果必须明确标记为 success-empty`);
		}
		if (domain.emptyResult?.mustNotMaskError !== true) {
			failures.push(
				`${domain.id}: 空结果必须声明不能掩盖鉴权、依赖、Provider 或持久化错误`,
			);
		}
		if (!domain.emptyResult?.meaning) {
			failures.push(`${domain.id}: 缺少成功空结果的业务含义`);
		}
		if (!Array.isArray(domain.errorCodes) || domain.errorCodes.length === 0) {
			failures.push(`${domain.id}: 至少登记一个域级稳定错误码`);
		} else {
			for (const code of domain.errorCodes) {
				if (!errorHandlerSource.includes(`"${code}"`)) {
					failures.push(`${domain.id}: 服务端错误处理器缺少错误码：${code}`);
				}
				if (!clientErrorSource.includes(`"${code}"`)) {
					failures.push(`${domain.id}: 小程序错误文案表缺少错误码：${code}`);
				}
				if (!publicApiDocumentation.includes(`\`${code}\``)) {
					failures.push(`${domain.id}: 公网 API 文档缺少错误码：${code}`);
				}
			}
		}
		if (
			!Array.isArray(domain.forbiddenCapabilities) ||
			domain.forbiddenCapabilities.length === 0
		) {
			failures.push(`${domain.id}: 必须登记当前明确关闭的能力`);
		} else {
			for (const capability of domain.forbiddenCapabilities) {
				if (typeof capability !== "string" || capability.trim().length === 0) {
					failures.push(`${domain.id}: 存在空的关闭能力说明`);
				}
			}
		}

		for (const page of domain.pages) {
			if (!registeredPages.has(page)) {
				failures.push(`${domain.id}: 页面未注册：${page}`);
			}
			for (const extension of [".json", ".ts", ".wxml", ".wxss"]) {
				const sourcePath = `apps/miniprogram/src/${page}${extension}`;
				if (!(await fileExists(sourcePath))) {
					failures.push(`${domain.id}: 页面源文件不存在：${sourcePath}`);
				}
			}
		}

		const apiModule = await readRepositoryFile(domain.apiModule);
		for (const routeToken of domain.internalRouteTokens) {
			if (!apiModule.includes(`"${routeToken}"`)) {
				failures.push(
					`${domain.id}: API 模块缺少实际路由 token：${routeToken}`,
				);
			}
		}

		for (const publicRoute of domain.publicRoutes) {
			if (
				!publicApiDocumentation.includes(
					`| \`${publicRoute.split(" ")[0]}\` | \`${publicRoute.split(" ").slice(1).join(" ")}\` |`,
				)
			) {
				failures.push(`${domain.id}: 公网 API 文档缺少路由：${publicRoute}`);
			}
		}

		for (const relativePath of [
			domain.apiModule,
			...domain.serviceFiles,
			...domain.domainFiles,
			...domain.adapterFiles,
			...domain.documentation,
		]) {
			if (!(await fileExists(relativePath))) {
				failures.push(`${domain.id}: 闭环文件不存在：${relativePath}`);
			}
		}

		for (const event of domain.logEvents) {
			if (!loggingDocumentation.includes(`\`${event}\``)) {
				failures.push(`${domain.id}: 日志文档缺少事件：${event}`);
			}
		}
	}

	return {
		failures,
		domainCount: READ_ONLY_DOMAIN_CATALOG.length,
		pageCount: READ_ONLY_DOMAIN_CATALOG.reduce(
			(total, domain) => total + domain.pages.length,
			0,
		),
		routeCount: READ_ONLY_DOMAIN_CATALOG.reduce(
			(total, domain) => total + domain.publicRoutes.length,
			0,
		),
		semanticStateCount: READ_ONLY_DOMAIN_CATALOG.reduce(
			(total, domain) => total + (domain.semanticStates?.length ?? 0),
			0,
		),
	};
}

if (import.meta.main) {
	const result = await auditReadOnlyDomains();
	if (result.failures.length > 0) {
		console.error("低风险业务域闭环审计失败：");
		for (const failure of result.failures) console.error(`- ${failure}`);
		process.exit(1);
	}

	console.log(
		`低风险业务域闭环审计通过：${result.domainCount} 个业务域、${result.pageCount} 个页面、${result.routeCount} 条公网路由、${result.semanticStateCount} 个语义状态；页面、API、实现、错误、日志和文档均有落点`,
	);
}
