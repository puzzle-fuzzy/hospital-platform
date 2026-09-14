import { describe, expect, test } from "bun:test";
import {
	normalizeWechatUserProfile,
	normalizeWechatUserProfileSelection,
	WechatUserProfileAuthorizationError,
	WechatUserProfileUnavailableError,
} from "./wechat-user-profile";

describe("微信个人资料授权边界", () => {
	test("接受昵称和 HTTPS 头像，并映射微信性别", () => {
		expect(
			normalizeWechatUserProfile({
				nickName: "  张三  ",
				avatarUrl: "https://wx.qlogo.cn/example/132",
				gender: 1,
			}),
		).toEqual({
			nickName: "张三",
			avatarUrl: "https://wx.qlogo.cn/example/132",
			gender: "male",
		});

		expect(
			normalizeWechatUserProfile({
				nickName: "李四",
				avatarUrl: "http://untrusted.example/avatar.png",
				gender: 2,
			}),
		).toBeNull();

		// 没有头像时仍然保留真实昵称；页面会使用安全的默认头像资源。
		expect(
			normalizeWechatUserProfile({
				nickName: "王五",
				avatarUrl: "",
				gender: 0,
			}),
		).toEqual({
			nickName: "王五",
			avatarUrl: "",
			gender: "unknown",
		});
	});

	test("拒绝空昵称、控制字符和超长昵称", () => {
		expect(
			normalizeWechatUserProfile({
				nickName: "\n张三",
				avatarUrl: "https://wx.qlogo.cn/example/132",
				gender: 0,
			}),
		).toBeNull();
		expect(
			normalizeWechatUserProfile({
				nickName: "a".repeat(65),
				avatarUrl: "https://wx.qlogo.cn/example/132",
				gender: 0,
			}),
		).toBeNull();
	});

	test("头像昵称填写组件接受微信沙箱头像路径并拒绝任意 HTTP 地址", () => {
		expect(
			normalizeWechatUserProfileSelection({
				nickName: "  新昵称  ",
				avatarUrl: "http://tmp/avatar-123.png",
			}),
		).toEqual({
			nickName: "新昵称",
			avatarUrl: "http://tmp/avatar-123.png",
		});
		expect(
			normalizeWechatUserProfileSelection({
				nickName: "新昵称",
				avatarUrl: "wxfile://store/avatar-123.png",
			}),
		).toEqual({
			nickName: "新昵称",
			avatarUrl: "wxfile://store/avatar-123.png",
		});
		expect(
			normalizeWechatUserProfileSelection({
				nickName: "新昵称",
				avatarUrl: "http://example.com/avatar.png",
			}),
		).toBeNull();
	});

	test("授权拒绝是独立的可重试错误，不等同于登录失效", () => {
		const error = new WechatUserProfileAuthorizationError();
		expect(error.code).toBe("wechat-profile-authorization-denied");
		expect(error.name).toBe("WechatUserProfileAuthorizationError");
	});

	test("微信基础库缺少资料接口时不伪装成用户拒绝", () => {
		const error = new WechatUserProfileUnavailableError();
		expect(error.code).toBe("wechat-profile-unavailable");
		expect(error.name).toBe("WechatUserProfileUnavailableError");
	});
});
