import { expect, test } from "bun:test";
import {
	auditEnvironmentTemplateFiles,
	auditEnvironmentTemplates,
} from "./env-template-audit.mjs";

test("仓库开发模板与生产 API 模板通过职责和安全默认值审计", async () => {
	const result = await auditEnvironmentTemplateFiles();

	expect(result.passed).toBe(true);
	expect(result.failures).toEqual([]);
	expect(result.sharedKeyCount).toBe(59);
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
