import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");

const ERROR_HANDLER_PATH = "apps/api/src/plugins/error-handler.ts";
const CLIENT_ERROR_TABLE_PATH = "apps/miniprogram/src/services/api-client.ts";
const PUBLIC_API_DOC_PATH = "docs/公共API-v2.md";
const ERROR_REGISTRY_PATH = "apps/miniprogram/src/services/error-registry.ts";
const ERROR_CODE_QUICK_REF_PATH = "docs/错误码.md";

const ERROR_CODE_PATTERN =
	/\b(?:code\s*:\s*|errorPayload\(\s*)["']([a-z0-9-]+)["']/gu;
const CLIENT_ERROR_TABLE_PATTERN =
	/export const CLIENT_ERROR_MESSAGES[\s\S]*?Object\.freeze\(\{([\s\S]*?)\}\);/u;
const CLIENT_ERROR_KEY_PATTERN =
	/(?:["']([a-z0-9-]+)["']|([a-z][a-z0-9-]*))\s*:/gu;
const PUBLIC_ERROR_TABLE_LINE_PATTERN = /^\|\s*\d+\s*\|/u;
const CODE_IN_TABLE_PATTERN = /`([a-z0-9-]+)`/gu;

/** 数字码表通用解析：export const <name> = Object.freeze({ key: 12300 }) as const; */
const NUMERIC_TABLE_PATTERN_BUILDER = (tableName) =>
	new RegExp(
		`export const ${tableName} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\s*as const\\);`,
		"u",
	);
const NUMERIC_TABLE_ENTRY_PATTERN =
	/(?:["']([a-z0-9-]+)["']|([a-z][a-z0-9-]*))\s*:\s*(\d{5})\s*,/gu;

/** 公共 API 文档错误表行：| 400 | 10100 | `code` | 含义 | */
const API_DOC_NUMERIC_ROW_PATTERN =
	/^\|\s*\d{3}\s*\|\s*(\d{5})\s*\|\s*`([a-z0-9-]+)`/u;
/** 错误码速查表行：| 10100 | `code` | 来源 | 说明 | */
const QUICK_REF_NUMERIC_ROW_PATTERN = /^\|\s*(\d{5})\s*\|\s*`([a-z0-9-]+)`/u;

/** 客户端本地数字码必须落在 80xxx 保留段，与服务端段位无交集。 */
const CLIENT_NUMERIC_RANGE = { min: 80000, maxExclusive: 81000 };

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

/** 从源码里的数字码表（如 ERROR_NUMERIC_CODES）提取 code → numeric 映射。 */
export function extractNumericCodeTable(source, tableName) {
	const table = source.match(NUMERIC_TABLE_PATTERN_BUILDER(tableName))?.[1];
	if (!table) throw new Error(`${tableName} table was not found`);
	const entries = new Map();
	for (const match of table.matchAll(NUMERIC_TABLE_ENTRY_PATTERN)) {
		const code = match[1] ?? match[2];
		if (!code) continue;
		entries.set(code, Number(match[3]));
	}
	if (entries.size === 0) throw new Error(`${tableName} table is empty`);
	return entries;
}

/** 从公共 API 文档的错误表提取 code → numeric 映射。 */
export function extractDocumentedNumericCodes(documentation) {
	const entries = new Map();
	for (const line of documentation.split("\n")) {
		const match = API_DOC_NUMERIC_ROW_PATTERN.exec(line);
		if (match?.[1] && match[2] && !entries.has(match[2])) {
			entries.set(match[2], Number(match[1]));
		}
	}
	return entries;
}

/** 从错误码速查表（docs/错误码.md）提取 code → numeric 映射。 */
export function extractQuickRefNumericCodes(documentation) {
	const entries = new Map();
	for (const line of documentation.split("\n")) {
		const match = QUICK_REF_NUMERIC_ROW_PATTERN.exec(line);
		if (match?.[1] && match[2] && !entries.has(match[2])) {
			entries.set(match[2], Number(match[1]));
		}
	}
	return entries;
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

/**
 * 数字错误码契约审计：
 * - 服务端 ERROR_NUMERIC_CODES 数值全局唯一，且覆盖全部可提取的字符串码字面量；
 * - 客户端 SERVER_ERROR_NUMERIC_CODES 镜像与服务端表完全一致；
 * - 客户端 CLIENT_ERROR_NUMERIC_CODES 全部落在 80xxx 保留段且不与服务端撞号；
 * - 公共 API 文档错误表的数字码列与服务端表双向一致；
 * - docs/错误码.md 速查表覆盖服务端与客户端全部条目且数值一致。
 */
export function auditErrorNumericContract({
	serverSource,
	registrySource,
	apiDocumentation,
	quickRefDocumentation,
}) {
	const failures = [];
	const serverMap = extractNumericCodeTable(
		serverSource,
		"ERROR_NUMERIC_CODES",
	);
	const mirrorMap = extractNumericCodeTable(
		registrySource,
		"SERVER_ERROR_NUMERIC_CODES",
	);
	const clientLocalMap = extractNumericCodeTable(
		registrySource,
		"CLIENT_ERROR_NUMERIC_CODES",
	);
	const apiDocMap = extractDocumentedNumericCodes(apiDocumentation);
	const quickRefMap = extractQuickRefNumericCodes(quickRefDocumentation);

	const seenNumerics = new Map();
	for (const [origin, table] of [
		["server", serverMap],
		["client-local", clientLocalMap],
	]) {
		for (const [code, numeric] of table) {
			const existing = seenNumerics.get(numeric);
			if (existing !== undefined) {
				failures.push(
					`数字码 ${numeric} 重复：${existing} 与 ${origin}:${code}`,
				);
				continue;
			}
			seenNumerics.set(numeric, `${origin}:${code}`);
		}
	}

	for (const code of extractServerErrorCodes(serverSource)) {
		if (!serverMap.has(code)) {
			failures.push(`服务端字符串码 ${code} 未分配数字码`);
		}
	}

	for (const [code, numeric] of mirrorMap) {
		if (serverMap.get(code) !== numeric) {
			failures.push(`客户端镜像 ${code}=${numeric} 与服务端不一致`);
		}
	}
	for (const code of serverMap.keys()) {
		if (!mirrorMap.has(code)) {
			failures.push(`客户端镜像缺少服务端码 ${code}`);
		}
	}

	for (const [code, numeric] of clientLocalMap) {
		if (
			numeric < CLIENT_NUMERIC_RANGE.min ||
			numeric >= CLIENT_NUMERIC_RANGE.maxExclusive
		) {
			failures.push(`客户端本地码 ${code}=${numeric} 超出 80xxx 保留段`);
		}
	}

	for (const [code, numeric] of apiDocMap) {
		if (serverMap.get(code) !== numeric) {
			failures.push(`API 文档 ${code}=${numeric} 与服务端数字码不一致`);
		}
	}
	for (const [code, numeric] of serverMap) {
		if (!apiDocMap.has(code)) {
			failures.push(`API 文档缺少数字码 ${code}=${numeric}`);
		}
	}

	for (const [code, numeric] of [...serverMap, ...clientLocalMap]) {
		if (quickRefMap.get(code) !== numeric) {
			failures.push(`错误码速查表 ${code}=${numeric} 缺失或数值不一致`);
		}
	}

	return {
		passed: failures.length === 0,
		failures,
		serverNumericCount: serverMap.size,
		clientLocalNumericCount: clientLocalMap.size,
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

/** 执行当前仓库的数字错误码一致性审计。 */
export async function auditCurrentErrorNumericContract(
	rootDirectory = repositoryRoot,
) {
	const [serverSource, registrySource, apiDoc, quickRefDoc] = await Promise.all(
		[
			readFile(join(rootDirectory, ERROR_HANDLER_PATH), "utf8"),
			readFile(join(rootDirectory, ERROR_REGISTRY_PATH), "utf8"),
			readFile(join(rootDirectory, PUBLIC_API_DOC_PATH), "utf8"),
			readFile(join(rootDirectory, ERROR_CODE_QUICK_REF_PATH), "utf8"),
		],
	);
	return auditErrorNumericContract({
		serverSource,
		registrySource,
		apiDocumentation: apiDoc,
		quickRefDocumentation: quickRefDoc,
	});
}

if (import.meta.main) {
	try {
		const [result, numericResult] = await Promise.all([
			auditCurrentErrorContract(),
			auditCurrentErrorNumericContract(),
		]);
		if (!result.passed || !numericResult.passed) {
			console.error(
				[
					"公共错误码契约审计失败",
					result.missingClientCodes.length > 0
						? `客户端缺少：${result.missingClientCodes.join(", ")}`
						: "",
					result.missingDocumentationCodes.length > 0
						? `文档缺少：${result.missingDocumentationCodes.join(", ")}`
						: "",
					numericResult.failures.length > 0
						? `数字码问题：${numericResult.failures.join("；")}`
						: "",
				]
					.filter(Boolean)
					.join("；"),
			);
			process.exitCode = 1;
		} else {
			console.log(
				`公共错误码契约审计通过：${result.serverCodes.length} 个服务端错误码均已同步客户端文案和 API 文档；数字码 ${numericResult.serverNumericCount} 服务端 + ${numericResult.clientLocalNumericCount} 客户端本地全部登记一致`,
			);
		}
	} catch (error) {
		console.error(
			`公共错误码契约审计无法执行：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
