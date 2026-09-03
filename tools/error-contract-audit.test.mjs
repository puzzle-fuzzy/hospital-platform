import { expect, test } from "bun:test";
import {
	auditCurrentErrorContract,
	auditCurrentErrorNumericContract,
	auditErrorContract,
	auditErrorNumericContract,
	extractDocumentedErrorCodes,
	extractNumericCodeTable,
} from "./error-contract-audit.mjs";

test("错误码提取器支持同一文档行登记多个 code", () => {
	expect(
		extractDocumentedErrorCodes(
			"| 400 | `validation` / `parse` | 请求不合法 |\n| 401 | `unauthorized` | 登录失效 |",
		),
	).toEqual(["parse", "unauthorized", "validation"]);
});

test("错误码审计报告客户端和文档的独立缺口", () => {
	const result = auditErrorContract({
		serverSource: `return { code: "server-one" }; return { code: "server-two" };`,
		clientSource: `export const CLIENT_ERROR_MESSAGES = Object.freeze({ "server-one": "一" });`,
		documentation: "| 400 | `server-one` | 已登记 |",
	});

	expect(result.passed).toBe(false);
	expect(result.missingClientCodes).toEqual(["server-two"]);
	expect(result.missingDocumentationCodes).toEqual(["server-two"]);
});

test("数字码表提取器支持裸键名与引号键名", () => {
	const table = extractNumericCodeTable(
		`export const EXAMPLE = Object.freeze({
	validation: 10100,
	"not-found": 10400,
} as const);`,
		"EXAMPLE",
	);
	expect(table.get("validation")).toBe(10100);
	expect(table.get("not-found")).toBe(10400);
});

test("数字码审计报告镜像漂移、段位越界与文档缺口", () => {
	const serverSource = `export const ERROR_NUMERIC_CODES = Object.freeze({
	"server-one": 10100,
} as const);
const handler = { code: "server-one" };`;
	const registrySource = `export const SERVER_ERROR_NUMERIC_CODES = Object.freeze({
	"server-one": 10101,
} as const);
export const CLIENT_ERROR_NUMERIC_CODES = Object.freeze({
	"local-one": 79999,
} as const);`;
	const result = auditErrorNumericContract({
		serverSource,
		registrySource,
		apiDocumentation: "| 400 | 10999 | `server-one` | 缺口 |",
		quickRefDocumentation: "| 10998 | `server-one` | 错 |",
	});

	expect(result.passed).toBe(false);
	const joined = result.failures.join("；");
	expect(joined).toContain("客户端镜像 server-one=10101 与服务端不一致");
	expect(joined).toContain("超出 80xxx 保留段");
	expect(joined).toContain("API 文档 server-one=10999 与服务端数字码不一致");
	expect(joined).toContain("速查表");
});

test("当前仓库的公共错误码已同步到客户端和文档", async () => {
	const result = await auditCurrentErrorContract();

	expect(result.passed).toBe(true);
	expect(result.missingClientCodes).toEqual([]);
	expect(result.missingDocumentationCodes).toEqual([]);
	expect(result.serverCodes.length).toBeGreaterThan(30);
});

test("当前仓库的数字错误码三处登记完全一致", async () => {
	const result = await auditCurrentErrorNumericContract();

	expect(result.passed).toBe(true);
	expect(result.failures).toEqual([]);
	expect(result.serverNumericCount).toBeGreaterThanOrEqual(42);
	expect(result.clientLocalNumericCount).toBeGreaterThanOrEqual(20);
});
