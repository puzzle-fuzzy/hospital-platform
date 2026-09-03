import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");

const ERROR_HANDLER_PATH = "apps/api/src/plugins/error-handler.ts";
const CLIENT_ERROR_TABLE_PATH = "apps/miniprogram/src/services/api-client.ts";
const PUBLIC_API_DOC_PATH = "docs/公共API-v2.md";

const ERROR_CODE_PATTERN = /\bcode\s*:\s*["']([a-z0-9-]+)["']/gu;
const CLIENT_ERROR_TABLE_PATTERN =
	/export const CLIENT_ERROR_MESSAGES[\s\S]*?Object\.freeze\(\{([\s\S]*?)\}\);/u;
const CLIENT_ERROR_KEY_PATTERN =
	/(?:["']([a-z0-9-]+)["']|([a-z][a-z0-9-]*))\s*:/gu;
const PUBLIC_ERROR_TABLE_LINE_PATTERN = /^\|\s*\d+\s*\|/u;
const CODE_IN_TABLE_PATTERN = /`([a-z0-9-]+)`/gu;

/** 从统一错误处理器提取真正可以返回给患者端的稳定 code 字面量。 */
export function extractServerErrorCodes(source) {
	return [...source.matchAll(ERROR_CODE_PATTERN)]
		.map((match) => match[1])
		.filter(Boolean)
		.filter((code, index, all) => all.indexOf(code) === index)
		.sort();
}

/** 只读取客户端稳定文案表，允许客户端额外保留本地网络/会话错误码。 */
export function extractClientErrorCodes(source) {
	const table = source.match(CLIENT_ERROR_TABLE_PATTERN)?.[1];
	if (!table) throw new Error("CLIENT_ERROR_MESSAGES table was not found");
	return [...table.matchAll(CLIENT_ERROR_KEY_PATTERN)]
		.map((match) => match[1] ?? match[2])
		.filter(Boolean)
		.filter((code, index, all) => all.indexOf(code) === index)
		.sort();
}

/** 从公共错误表提取 code；一行合并多个 code 时逐个登记。 */
export function extractDocumentedErrorCodes(documentation) {
	const codes = new Set();
	for (const line of documentation.split("\n")) {
		if (!PUBLIC_ERROR_TABLE_LINE_PATTERN.test(line)) continue;
		for (const match of line.matchAll(CODE_IN_TABLE_PATTERN)) {
			if (match[1]) codes.add(match[1]);
		}
	}
	return [...codes].sort();
}

/** 比较三层错误契约，只报告缺失，不要求客户端删除本地专用错误码。 */
export function auditErrorContract({
	serverSource,
	clientSource,
	documentation,
}) {
	const serverCodes = extractServerErrorCodes(serverSource);
	const clientCodes = new Set(extractClientErrorCodes(clientSource));
	const documentedCodes = new Set(extractDocumentedErrorCodes(documentation));
	const missingClientCodes = serverCodes.filter(
		(code) => !clientCodes.has(code),
	);
	const missingDocumentationCodes = serverCodes.filter(
		(code) => !documentedCodes.has(code),
	);

	return {
		passed:
			missingClientCodes.length === 0 && missingDocumentationCodes.length === 0,
		serverCodes,
		clientCodes: [...clientCodes].sort(),
		documentedCodes: [...documentedCodes].sort(),
		missingClientCodes,
		missingDocumentationCodes,
	};
}

/** 执行当前仓库的服务端—客户端—文档错误码一致性审计。 */
export async function auditCurrentErrorContract(
	rootDirectory = repositoryRoot,
) {
	const [serverSource, clientSource, documentation] = await Promise.all([
		readFile(join(rootDirectory, ERROR_HANDLER_PATH), "utf8"),
		readFile(join(rootDirectory, CLIENT_ERROR_TABLE_PATH), "utf8"),
		readFile(join(rootDirectory, PUBLIC_API_DOC_PATH), "utf8"),
	]);
	return auditErrorContract({ serverSource, clientSource, documentation });
}

if (import.meta.main) {
	try {
		const result = await auditCurrentErrorContract();
		if (!result.passed) {
			console.error(
				[
					"公共错误码契约审计失败",
					result.missingClientCodes.length > 0
						? `客户端缺少：${result.missingClientCodes.join(", ")}`
						: "",
					result.missingDocumentationCodes.length > 0
						? `文档缺少：${result.missingDocumentationCodes.join(", ")}`
						: "",
				]
					.filter(Boolean)
					.join("；"),
			);
			process.exitCode = 1;
		} else {
			console.log(
				`公共错误码契约审计通过：${result.serverCodes.length} 个服务端错误码均已同步客户端文案和 API 文档`,
			);
		}
	} catch (error) {
		console.error(
			`公共错误码契约审计无法执行：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
