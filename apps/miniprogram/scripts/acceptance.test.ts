import { join } from "node:path";
import { expect, test } from "bun:test";

const sourceRoot = join(import.meta.dir, "..", "src");

async function source(file: string): Promise<string> {
	return Bun.file(join(sourceRoot, file)).text();
}

test("native client keeps WeChat identity exchange on the Hospital API", async () => {
	const client = await source("services/api-client.js");

	expect(client).toContain("wx.login");
	expect(client).toContain("/api/v1/auth/wechat");
	expect(client).not.toContain("/sns/jscode2session");
	expect(client).not.toContain("api.weixin.qq.com");
});

test("native client requests server-generated prepay parameters", async () => {
	const client = await source("services/api-client.js");

	expect(client).toContain("requestWechatPrepay");
	expect(client).toContain("/wechat-prepay");
	expect(client).not.toContain("paySign =");
});
