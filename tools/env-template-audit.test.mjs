import { expect, test } from "bun:test";
import {
	auditEnvironmentTemplateFiles,
	auditEnvironmentTemplates,
} from "./env-template-audit.mjs";

test("仓库开发模板与生产 API 模板通过职责和安全默认值审计", async () => {
	const result = await auditEnvironmentTemplateFiles();

	expect(result.passed).toBe(true);
	expect(result.failures).toEqual([]);
	expect(result.sharedKeyCount).toBe(95);
});

test("医保正式模板拒绝退回测试默认或填入尚未确认的6201测试目标", () => {
	const result = auditEnvironmentTemplates({
		developmentTemplate: [
			"MBS_FORWARD_BASE_URL=http://124.164.248.83:51000",
			"MBS_USER_QUERY_BASE_URL=https://test-receiver.wecity.qq.com",
		].join("\n"),
		productionTemplate: [
			"MBS_FORWARD_BASE_URL=http://124.164.248.83:51000",
			"MBS_FORWARD_BASE_URL_6201=http://124.164.248.83:56380",
			"MBS_USER_QUERY_BASE_URL=https://test-receiver.wecity.qq.com",
			"WECHAT_MEDICAL_INSURANCE_TEST_ENVIRONMENT=true",
		].join("\n"),
	});

	expect(result.passed).toBe(false);
	for (const template of [".env.example", "infra/systemd/api.env.example"]) {
		expect(result.failures).toContain(
			`${template} MBS_FORWARD_BASE_URL 必须固定为 http://124.164.248.83:50080，当前为 http://124.164.248.83:51000`,
		);
		expect(result.failures).toContain(
			`${template} MBS_USER_QUERY_BASE_URL 必须固定为 https://receiver.wecity.qq.com，当前为 https://test-receiver.wecity.qq.com`,
		);
	}
	expect(result.failures).toContain(
		"infra/systemd/api.env.example MBS_FORWARD_BASE_URL_6201 必须固定为 ，当前为 http://124.164.248.83:56380",
	);
	expect(result.failures).toContain(
		"infra/systemd/api.env.example WECHAT_MEDICAL_INSURANCE_TEST_ENVIRONMENT 必须固定为 false，当前为 true",
	);
});

test("生产模板拒绝本机地址和真实凭据占位符缺失", () => {
	const result = auditEnvironmentTemplates({
		developmentTemplate: "NODE_ENV=development\n",
		productionTemplate: [
			"NODE_ENV=production",
			"DATABASE_URL=mysql://root:real-password@127.0.0.1/db",
		].join("\n"),
	});

	expect(result.passed).toBe(false);
	expect(result.failures).toContain(
		"infra/systemd/api.env.example DATABASE_URL 必须保留占位符，禁止放入真实凭据",
	);
	expect(result.failures).toContain(
		"infra/systemd/api.env.example DATABASE_URL 不得使用本机地址：mysql://root:real-password@127.0.0.1/db",
	);
});
