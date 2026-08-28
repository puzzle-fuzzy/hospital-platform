import { describe, expect, test } from "bun:test";
import { parseProviderTlsUrl } from "./provider-tls-audit";

describe("众阳 TLS 地址审计输入", () => {
	test("只接受 HTTPS 地址并保留 SNI 主机名", () => {
		const url = parseProviderTlsUrl("https://gpsrmyy.meiyi.pro/some/path");

		expect(url.protocol).toBe("https:");
		expect(url.hostname).toBe("gpsrmyy.meiyi.pro");
	});

	test("拒绝明文 HTTP", () => {
		expect(() => parseProviderTlsUrl("http://provider.example.com")).toThrow(
			"requires an HTTPS URL",
		);
	});

	test("拒绝嵌入 URL 的账号密码", () => {
		expect(() =>
			parseProviderTlsUrl("https://user:secret@provider.example.com"),
		).toThrow("does not accept URL credentials");
	});
});
