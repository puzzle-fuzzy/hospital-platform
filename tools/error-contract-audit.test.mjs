import { expect, test } from "bun:test";
import {
	auditCurrentErrorContract,
	auditErrorContract,
	extractDocumentedErrorCodes,
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

test("当前仓库的公共错误码已同步到客户端和文档", async () => {
	const result = await auditCurrentErrorContract();

	expect(result.passed).toBe(true);
	expect(result.missingClientCodes).toEqual([]);
	expect(result.missingDocumentationCodes).toEqual([]);
	expect(result.serverCodes.length).toBeGreaterThan(30);
});
