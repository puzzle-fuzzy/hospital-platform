import { describe, expect, test } from "bun:test";
import { isPublicRequestPath } from "./request-authentication";

describe("公开入口路径边界", () => {
	test("只允许精确的模块路径，不接受伪造尾缀", () => {
		expect(isPublicRequestPath("/auth/wechat", ["/auth/wechat"])).toBe(true);
		expect(isPublicRequestPath("/api/v1/auth/wechat", ["/auth/wechat"])).toBe(
			true,
		);
		expect(isPublicRequestPath("/api/v2/auth/wechat", ["/auth/wechat"])).toBe(
			true,
		);

		// 尾缀相同但路由层级不同，必须继续要求 Bearer，不能被当成公开登录入口。
		expect(
			isPublicRequestPath("/api/v1/other/auth/wechat", ["/auth/wechat"]),
		).toBe(false);
		expect(
			isPublicRequestPath("/api/v1/auth/wechat/extra", ["/auth/wechat"]),
		).toBe(false);
	});
});
