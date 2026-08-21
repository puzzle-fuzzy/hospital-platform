import { describe, expect, test } from "bun:test";
import { auditDeviceEvidence } from "./device-evidence-audit.mjs";

const candidate = {
	serverRelease: "5a31427",
	miniProgramCommit: "39ad2c5",
	sourceRevision: "39ad2c5937af2fdc735ffb223c0648464af3a48c",
};

const domainNames = [
	"auth",
	"patientDirectory",
	"patientSelection",
	"appointmentRecords",
	"missedAppointments",
	"outpatientPayment",
];

function pendingDomains() {
	return Object.fromEntries(
		domainNames.map((domain) => [
			domain,
			{ result: "pending", reason: "等待当前候选真机操作" },
		]),
	);
}

function passedEvidence() {
	return {
		result: "passed",
		page: {
			observedAt: "2026-08-21T08:00:00+08:00",
			screenshot: true,
			summary: "页面显示本业务的安全结果",
		},
		client: {
			requestId: "123e4567-e89b-12d3-a456-426614174000",
			path: "/api/v2/me",
			statusCode: 200,
		},
		server: {
			auditPassed: true,
			correlationFingerprint:
				"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			requested: 1,
			succeeded: 1,
			http2xx: 1,
			failed: 0,
		},
	};
}

function completeManifest() {
	return {
		// 每个测试都复制候选，避免来源错配测试污染后续测试。
		candidate: { ...candidate },
		startedAt: "2026-08-21T08:00:00+08:00",
		domains: pendingDomains(),
	};
}

describe("device evidence audit", () => {
	test("允许当前候选的全量 pending 清单，并安全输出摘要", () => {
		const result = auditDeviceEvidence(completeManifest());
		expect(result.passed).toBe(false);
		expect(Object.keys(result.domains)).toHaveLength(6);
		expect(result.domains.auth.reasonRecorded).toBe(true);
	});

	test("只有页面、客户端和同链服务端证据齐全时才允许 passed", () => {
		const manifest = completeManifest();
		manifest.domains.auth = passedEvidence();
		const result = auditDeviceEvidence(manifest);
		expect(result.passed).toBe(false);
		expect(result.domains.auth.result).toBe("passed");

		manifest.domains.patientDirectory = passedEvidence();
		manifest.domains.patientDirectory.client.statusCode = 401;
		expect(() => auditDeviceEvidence(manifest)).toThrow(
			"客户端 HTTP 必须为 2xx",
		);
	});

	test("接受小程序真实生成的有界 requestId，不错误要求 UUID", () => {
		const manifest = completeManifest();
		manifest.domains.auth = passedEvidence();
		manifest.domains.auth.client.requestId = "mp-m123abc-abcdef12";
		const result = auditDeviceEvidence(manifest);
		expect(result.domains.auth.result).toBe("passed");
	});

	test("拒绝候选来源错配", () => {
		const manifest = completeManifest();
		manifest.candidate.sourceRevision =
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		expect(() => auditDeviceEvidence(manifest)).toThrow(
			"必须以 miniProgramCommit 开头",
		);
	});

	test("真机清单必须绑定调用方提供的当前发布基线", () => {
		const manifest = completeManifest();
		manifest.candidate = {
			serverRelease: "5a31427",
			miniProgramCommit: "acf5a85",
			sourceRevision: "acf5a8596e70e1fb2b8d220a0b41eb69418ae086",
		};
		expect(() => auditDeviceEvidence(manifest, candidate)).toThrow(
			"与当前发布基线不一致",
		);
	});

	test("拒绝把 token、身份证、完整卡号或原始报文写进证据", () => {
		const tokenManifest = completeManifest();
		tokenManifest.domains.auth = passedEvidence();
		tokenManifest.domains.auth.reason = "Bearer eyJheader.payload.signature";
		expect(() => auditDeviceEvidence(tokenManifest)).toThrow("敏感内容");

		const idManifest = completeManifest();
		idManifest.domains.auth = passedEvidence();
		idManifest.domains.auth.page.summary = "身份证 330782199903271910";
		expect(() => auditDeviceEvidence(idManifest)).toThrow("敏感内容");

		const fieldManifest = completeManifest();
		fieldManifest.domains.auth = passedEvidence();
		fieldManifest.domains.auth.client.authorization = "不要记录";
		expect(() => auditDeviceEvidence(fieldManifest)).toThrow("敏感字段");
	});

	test("拒绝不带公共版本前缀或查询参数的客户端路径", () => {
		const manifest = completeManifest();
		manifest.domains.auth = passedEvidence();
		manifest.domains.auth.client.path = "/auth/wechat";
		expect(() => auditDeviceEvidence(manifest)).toThrow("公共 /api/v2 路径");
	});
});
