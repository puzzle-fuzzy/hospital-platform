import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { READ_ONLY_DOMAIN_CATALOG } from "./read-only-domain-catalog.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function readRepositoryFile(relativePath) {
	return Bun.file(join(repositoryRoot, relativePath)).text();
}

async function fileExists(relativePath) {
	return Bun.file(join(repositoryRoot, relativePath)).exists();
}

/**
 * 校验“只读域闭环”而不是只校验一个列表页。
 * 页面存在只能说明入口不再 404；真正的迁移闭环还必须能追到 API 路由、
 * service/domain/adapter 实现、日志事件以及对应的契约/验收文档。
 */
export async function auditReadOnlyDomains() {
	const failures = [];
	const seenDomainIds = new Set();
	const appJson = JSON.parse(
		await readRepositoryFile("apps/miniprogram/src/app.json"),
	);
	const registeredPages = new Set(appJson.pages ?? []);
	const publicApiDocumentation = await readRepositoryFile(
		"docs/api-v2-public.md",
	);
	const loggingDocumentation = await readRepositoryFile("docs/logging.md");

	for (const domain of READ_ONLY_DOMAIN_CATALOG) {
		if (seenDomainIds.has(domain.id)) {
			failures.push(`重复的只读业务域 id：${domain.id}`);
		}
		seenDomainIds.add(domain.id);

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
	};
}

if (import.meta.main) {
	const result = await auditReadOnlyDomains();
	if (result.failures.length > 0) {
		console.error("只读业务域闭环审计失败：");
		for (const failure of result.failures) console.error(`- ${failure}`);
		process.exit(1);
	}

	console.log(
		`只读业务域闭环审计通过：${result.domainCount} 个业务域、${result.pageCount} 个页面、${result.routeCount} 条公网路由；页面、API、实现、日志和文档均有落点`,
	);
}
