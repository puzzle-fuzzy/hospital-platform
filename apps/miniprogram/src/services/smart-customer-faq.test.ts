import { describe, expect, test } from "bun:test";
import appJson from "../app.json";
import {
	SMART_CUSTOMER_FAQ_GROUPS,
	smartCustomerFaqActionUrl,
} from "./smart-customer-faq";

describe("smart-customer-faq", () => {
	test("常见问题目录覆盖门诊与住院一站式必需主题", () => {
		const groupTitles = SMART_CUSTOMER_FAQ_GROUPS.map(
			(group) => group.title,
		).join("\n");
		expect(groupTitles).toContain("门诊");
		expect(groupTitles).toContain("住院");

		const questions = SMART_CUSTOMER_FAQ_GROUPS.flatMap((group) =>
			group.items.map((item) => item.question),
		).join("\n");
		for (const topic of ["接诊须知", "办卡", "病历复印"]) {
			expect(questions).toContain(topic);
		}
	});

	test("常见问题答案不编造电话号码或具体时间", () => {
		for (const group of SMART_CUSTOMER_FAQ_GROUPS) {
			for (const item of group.items) {
				// 现场细节以医院公示为准，目录内不允许出现电话和钟点数字。
				expect(item.answer).not.toMatch(/\d{3,4}-\d{7,8}/u);
				expect(item.answer).not.toMatch(/\d{1,2}:\d{2}/u);
				expect(item.answer.length).toBeLessThanOrEqual(300);
			}
		}
	});

	test("常见问题跳转只指向 app.json 已注册页面", () => {
		const pages = new Set<string>(appJson.pages);
		for (const group of SMART_CUSTOMER_FAQ_GROUPS) {
			for (const item of group.items) {
				if (!item.action) continue;
				expect(item.action.url.startsWith("/pages/")).toBe(true);
				expect(pages.has(item.action.url.slice(1))).toBe(true);
			}
		}
	});

	test("smartCustomerFaqActionUrl 只返回目录内登记的路径", () => {
		expect(smartCustomerFaqActionUrl("patient-card-process")).toBe(
			"/pages/patient-binding/patient-binding",
		);
		expect(smartCustomerFaqActionUrl("report-fee-query")).toBe(
			"/pages/outpatient-payment/outpatient-payment",
		);
		expect(smartCustomerFaqActionUrl("not-registered")).toBeUndefined();
	});
});
