import { expect, test } from "bun:test";
import {
	createWechatMedicalUserQueryHeaders,
	resolveWechatMedicalUserQueryPartnerId,
} from "./wechat-medical-user-query-signature";

test("userQuery 签名遵循官方 UTF-8 HMAC-SHA256 与小写 HEX 协议", () => {
	const headers = createWechatMedicalUserQueryHeaders({
		path: "/api/mipuserquery/userQuery/synthetic-partner",
		partnerSecret: "synthetic-user-query-secret",
		now: () => new Date(1700000000000),
	});
	// 独立用 Python 标准库 hmac/hashlib 生成，不由待测签名函数计算期望值。
	expect(headers["god-portal-signature"]).toBe(
		"53ee199367092f9d0e2bcac2a2515d07a4833d1eea6c191e0daed33f1c80455d",
	);
	expect(headers["god-portal-timestamp"]).toBe("1700000000000");
	expect(headers["god-portal-request-id"]).toMatch(/^[a-f0-9]{32}$/u);
	expect(JSON.stringify(headers)).not.toContain("synthetic-user-query-secret");
});

test("签名对真实路径合作方与毫秒时间戳的变化敏感", () => {
	const first = createWechatMedicalUserQueryHeaders({
		path: "/api/mipuserquery/userQuery/synthetic-partner",
		partnerSecret: "synthetic-user-query-secret",
		now: () => new Date(1700000000000),
	});
	const otherPartner = createWechatMedicalUserQueryHeaders({
		path: "/api/mipuserquery/userQuery/other-synthetic-partner",
		partnerSecret: "synthetic-user-query-secret",
		now: () => new Date(1700000000000),
	});
	const later = createWechatMedicalUserQueryHeaders({
		path: "/api/mipuserquery/userQuery/synthetic-partner",
		partnerSecret: "synthetic-user-query-secret",
		now: () => new Date(1700000000001),
	});
	expect(otherPartner["god-portal-signature"]).not.toBe(
		first["god-portal-signature"],
	);
	expect(later["god-portal-signature"]).not.toBe(first["god-portal-signature"]);
	expect(later["god-portal-timestamp"]).toBe("1700000000001");
});

test("每次授权查询都产生新的随机 32 字符 request-id", () => {
	const ids = Array.from({ length: 32 }, () => {
		const headers = createWechatMedicalUserQueryHeaders({
			path: "/api/mipuserquery/userQuery/synthetic-partner",
			partnerSecret: "synthetic-user-query-secret",
			now: () => new Date(1700000000000),
		});
		const id = headers["god-portal-request-id"];
		expect(id).toMatch(/^[a-f0-9]{32}$/u);
		return id;
	});
	expect(new Set(ids).size).toBe(ids.length);
});

test.each([new Date(Number.NaN), new Date(0)])(
	"本机时间无法产生 13 位毫秒时间戳时拒绝授权查询",
	(now) => {
		expect(() =>
			createWechatMedicalUserQueryHeaders({
				path: "/api/mipuserquery/userQuery/synthetic-partner",
				partnerSecret: "synthetic-user-query-secret",
				now: () => now,
			}),
		).toThrow("adapter:medical-insurance");
	},
);

test("userQuery partnerId 来自实际路径的完整安全段，不限于数字", () => {
	expect(
		resolveWechatMedicalUserQueryPartnerId(
			"/api/mipuserquery/userQuery/synthetic-partner._~001",
		),
	).toBe("synthetic-partner._~001");
});

test.each([
	"/api/mipuserquery/userQuery/",
	"/api/mipuserquery/userQuery/.",
	"/api/mipuserquery/userQuery/..",
	"/api/mipuserquery/userQuery/partner/other",
	"/api/mipuserquery/userQuery/partner?extra=1",
	"/api/mipuserquery/userQuery/partner#extra",
	"/api/mipuserquery/userQuery/%70artner",
	"/api/mipuserquery/userQuery/partner%2fother",
	"/api/mipuserquery/userQuery/partner\\other",
	"/api/mipuserquery/userQuery/partner ",
	"/api/mipuserquery/userQuery/partner\n",
	"/api/mipuserquery/userQuery/partner\r",
	"/api/mipuserquery/userQuery/partner\r\n",
	"//receiver.example/api/mipuserquery/userQuery/partner",
	"https://receiver.example/api/mipuserquery/userQuery/partner",
	"/wrong-prefix/userQuery/partner",
])("userQuery 拒绝存在路径歧义的合作方标识：%s", (path) => {
	expect(() => resolveWechatMedicalUserQueryPartnerId(path)).toThrow(
		"adapter:medical-insurance",
	);
});
