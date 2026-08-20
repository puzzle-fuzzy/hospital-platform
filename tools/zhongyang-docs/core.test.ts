import { describe, expect, test } from "bun:test";
import {
	captureFingerprint,
	classifyQuery,
	createIntakeMarkdown,
	sanitizeNetworkBody,
	sanitizeText,
} from "./core.ts";
import { normalizeApiCapture, renderNormalizedMarkdown } from "./normalize.ts";
import type { QueryCapture } from "./types.ts";

describe("众阳文档查询纯函数边界", () => {
	test("搜索无结果不被推断为未授权", () => {
		expect(
			classifyQuery({
				visibleText: "暂无搜索结果",
				matchedResultCount: 0,
				responseStatuses: [200],
			}),
		).toBe("not_found");
	});

	test("只有门户明确拒绝时才标记为无权限", () => {
		expect(
			classifyQuery({
				visibleText: "当前账号无权限访问该接口",
				matchedResultCount: 0,
				responseStatuses: [200],
			}),
		).toBe("explicit_denied");
		expect(
			classifyQuery({
				visibleText: "",
				matchedResultCount: 0,
				responseStatuses: [403],
			}),
		).toBe("explicit_denied");
	});

	test("验证码和会话过期优先于页面结果猜测", () => {
		expect(
			classifyQuery({
				visibleText: "请完成滑动验证",
				matchedResultCount: 1,
				responseStatuses: [200],
			}),
		).toBe("captcha_required");
		expect(
			classifyQuery({
				visibleText: "登录已过期，请重新登录",
				matchedResultCount: 1,
				responseStatuses: [200],
			}),
		).toBe("session_expired");
	});

	test("敏感字段和值都会被清理", () => {
		const text = sanitizeText(
			"Authorization: Bearer abc.def\n手机号 13800138000\n普通字段 2.6.65.2",
		);
		expect(text).not.toContain("abc.def");
		expect(text).not.toContain("13800138000");
		expect(text).toContain("2.6.65.2");

		const body = sanitizeNetworkBody(
			JSON.stringify({ token: "secret-token", path: "/docs/2.6.65.2" }),
		) as Record<string, unknown>;
		expect(body.token).toBe("[REDACTED]");
		expect(body.path).toBe("/docs/2.6.65.2");
	});

	test("文档草稿带稳定来源指纹和冻结边界", () => {
		const capture: QueryCapture = {
			query: "2.6.65.2",
			status: "found",
			title: "接口文档",
			pageUrl: "https://docs.example.test/interface/2.6.65.2",
			capturedAt: "2026-08-20T00:00:00.000Z",
			visibleText: "请求参数\n返回参数",
			resultLabels: ["2.6.65.2 接口文档"],
			matchedResultCount: 1,
			network: [],
			notes: [],
		};
		const markdown = createIntakeMarkdown(capture);
		expect(markdown).toContain("2.6.65.2");
		expect(markdown).toContain("当前状态：`normalized`");
		expect(markdown).toContain("SHA-256");
		expect(markdown).toContain("冻结边界");
		expect(captureFingerprint(capture)).toMatch(/^[a-f0-9]{64}$/u);
	});

	test("从详情响应整理请求和返回字段树", () => {
		const capture: QueryCapture = {
			query: "2.6.65.2",
			status: "found",
			title: "众阳云门户",
			pageUrl: "https://openapi.msuncloud.com/document",
			capturedAt: "2026-08-20T00:00:00.000Z",
			visibleText: "接口详情",
			resultLabels: ["2.6.65.2"],
			matchedResultCount: 1,
			network: [
				{
					method: "GET",
					url: "https://openapi.msuncloud.com/portal/service/getApiDetail",
					status: 200,
					contentType: "application/json",
					resourceType: "xhr",
					body: {
						data: {
							id: "1",
							interfaceName: "2.6.65.2.发起支付",
							interfaceType: "POST",
							url: "/payment/pre-order",
							interfaceDescription: "application/json",
							reqBody: {
								type: "object",
								name: "root",
								objectProps: [
									{
										type: "string",
										name: "businessId",
										required: 1,
										desc: "结算单 ID",
									},
								],
							},
							resBody: {
								type: "object",
								name: "root",
								objectProps: [
									{
										type: "object",
										name: "data",
										objectProps: [
											{
												type: "bool",
												name: "success",
												required: 1,
											},
										],
									},
								],
							},
							interfaceInputExample: '{"businessId":1}',
							interfaceOutputExample: '{"success":true}',
						},
					},
				},
			],
			notes: [],
		};
		const normalized = normalizeApiCapture(capture);
		expect(normalized?.request.fields[0]?.path).toBe("businessId");
		expect(normalized?.response.fields[1]?.path).toBe("data.success");
		expect(normalized?.request.example).toEqual({ businessId: 1 });
		expect(
			renderNormalizedMarkdown(normalized as NonNullable<typeof normalized>),
		).toContain("data.success");
	});
});
