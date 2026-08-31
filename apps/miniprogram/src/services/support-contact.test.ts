import { expect, test } from "bun:test";
import {
	getSupportContactModalContent,
	getSupportPhoneText,
	SUPPORT_CONTACT,
} from "./support-contact";

test("客服公开信息由单一配置生成", () => {
	expect(getSupportPhoneText()).toBe(`客服电话：${SUPPORT_CONTACT.phone}`);
	expect(getSupportContactModalContent()).toBe(
		`客服电话：${SUPPORT_CONTACT.phone}\n${SUPPORT_CONTACT.workHours}`,
	);
});

test("客服公开配置不应包含可被误认为工单成功的状态", () => {
	expect(SUPPORT_CONTACT.phone).toMatch(/^1\d{10}$/u);
	expect(SUPPORT_CONTACT.workHours).toBe("工作日：08:00-17:00");
});
