import { expect, test } from "bun:test";
import { auditSecretContent, auditSensitivePaths } from "./secret-audit.mjs";

test("secret scan 只返回定位信息，不返回秘密原文", () => {
	const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
	const findings = auditSecretContent(
		".env.prod",
		["WECHAT_APP_SECRET=not-a-real-secret-value", privateKeyMarker].join("\n"),
	);

	expect(findings).toEqual([
		{ reason: "private-key-marker", path: ".env.prod", line: 2 },
		{ reason: "credential-assignment", path: ".env.prod", line: 1 },
	]);
	expect(JSON.stringify(findings)).not.toContain("not-a-real-secret-value");
});

test("secret scan 允许示例模板，拒绝真实 env、PEM 和 key 路径", () => {
	const findings = auditSensitivePaths([
		".env.example",
		"infra/api.env.example",
		"env/.env.prod",
		"env/wechat/apiclient_key.pem",
		"secrets/private.key",
	]);

	expect(findings).toEqual([
		{
			reason: "sensitive-file-name",
			path: "env/.env.prod",
			source: "worktree",
		},
		{
			reason: "sensitive-file-name",
			path: "env/wechat/apiclient_key.pem",
			source: "worktree",
		},
		{
			reason: "sensitive-file-name",
			path: "secrets/private.key",
			source: "worktree",
		},
	]);
});
