import { describe, expect, test } from "bun:test";
import {
	normalizeWechatUserProfile,
	WechatUserProfileAuthorizationError,
} from "./wechat-user-profile";

describe("微信个人资料授权边界", () => {
	test("只接受完整的昵称和 HTTPS 头像，并映射微信性别", () => {
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

	test("授权拒绝是独立的可重试错误，不等同于登录失效", () => {
		const error = new WechatUserProfileAuthorizationError();
		expect(error.code).toBe("wechat-profile-authorization-denied");
		expect(error.name).toBe("WechatUserProfileAuthorizationError");
	});
});
