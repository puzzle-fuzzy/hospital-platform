import { describe, expect, test } from "bun:test";
import {
	auditDeviceEvidence,
	DOMAIN_REQUIRED_SCENARIOS,
	isPendingDeviceEvidenceManifest,
} from "./device-evidence-audit.mjs";

const candidate = {
	serverRelease: "5a31427",
	miniProgramCommit: "c86a788",
	sourceRevision: "c86a788c01760fd5a74ac8c2769871025297a4fc",
};

const domainNames = [
	"auth",
	"patientDirectory",
	"patientDirectorySync",
	"patientSelection",
	"appointmentDirectory",
	"appointmentRecords",
	"missedAppointments",
	"outpatientPayment",
	"profileReadonlyWrite",
];

function pendingDomains() {
	return Object.fromEntries(
		domainNames.map((domain) => [
			domain,
			{
				result: "pending",
				reason: "等待当前候选真机操作",
				requiredScenarios: [...DOMAIN_REQUIRED_SCENARIOS[domain]],
			},
		]),
	);
}

const singleRequestPaths = {
	auth: { method: "POST", path: "/api/v2/auth/wechat" },
	patientDirectory: { method: "GET", path: "/api/v2/patients" },
	patientDirectorySync: { method: "POST", path: "/api/v2/patients/sync" },
	patientSelection: { method: "GET", path: "/api/v2/patients" },
	appointmentRecords: {
		method: "GET",
		path: "/api/v2/appointments/records",
	},
	missedAppointments: {
		method: "GET",
		path: "/api/v2/appointments/records",
	},
	outpatientPayment: {
		method: "GET",
		path: "/api/v2/payments/outpatient/records",
	},
};

const singleRequestBusinessDomains = {
	auth: "auth",
	patientDirectory: "patientRead",
	patientDirectorySync: "patientSync",
	patientSelection: "patientRead",
	appointmentRecords: "appointmentRecords",
	missedAppointments: "appointmentRecords",
	outpatientPayment: "outpatientPaymentRecords",
};

function passedEvidence(domain = "auth") {
	const request = singleRequestPaths[domain];
	return {
		result: "passed",
		scenarios: [...DOMAIN_REQUIRED_SCENARIOS[domain]],
		page: {
			observedAt: "2026-08-21T08:00:00+08:00",
			screenshot: true,
			summary: "页面显示本业务的安全结果",
		},
		client: {
			requestId: "123e4567-e89b-12d3-a456-426614174000",
			method: request.method,
			path: request.path,
			statusCode: 200,
		},
		server: {
			auditPassed: true,
			businessDomain: singleRequestBusinessDomains[domain],
			correlationFingerprint:
				"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			requested: 1,
			succeeded: 1,
			http2xx: 1,
			failed: 0,
		},
	};
}

function profilePassedEvidence() {
	const serverEvidence = (businessDomain, correlationFingerprint) => ({
		auditPassed: true,
		businessDomain,
		correlationFingerprint,
		requested: 1,
		succeeded: 1,
		http2xx: 1,
		failed: 0,
	});
	return {
		result: "passed",
		scenarios: [...DOMAIN_REQUIRED_SCENARIOS.profileReadonlyWrite],
		page: {
			observedAt: "2026-08-21T08:00:00+08:00",
			screenshot: true,
			summary: "页面显示资料读取和保存后的规范化结果",
		},
		client: {
			read: {
				requestId: "profile-read-001",
				method: "GET",
				path: "/api/v2/me/profile",
				statusCode: 200,
			},
			update: {
				requestId: "profile-update-001",
				method: "PUT",
				path: "/api/v2/me/profile",
				statusCode: 200,
			},
		},
		server: {
			auditPassed: true,
			read: serverEvidence(
				"profileRead",
				"1111111111111111111111111111111111111111111111111111111111111111",
			),
			update: serverEvidence(
				"profileUpdate",
				"2222222222222222222222222222222222222222222222222222222222222222",
			),
		},
	};
}

function appointmentDirectoryPassedEvidence() {
	const serverEvidence = (businessDomain, correlationFingerprint) => ({
		auditPassed: true,
		businessDomain,
		correlationFingerprint,
		requested: 1,
		succeeded: 1,
		http2xx: 1,
		failed: 0,
	});
	return {
		result: "passed",
		scenarios: [...DOMAIN_REQUIRED_SCENARIOS.appointmentDirectory],
		page: {
			observedAt: "2026-08-21T08:00:00+08:00",
			screenshot: true,
			summary: "页面显示科室、日期分组和排班号源",
		},
		client: {
			departments: {
				requestId: "appointment-departments-001",
				method: "GET",
				path: "/api/v2/appointments/departments",
				statusCode: 200,
			},
			schedules: {
				requestId: "appointment-schedules-001",
				method: "GET",
				path: "/api/v2/appointments/schedules",
				statusCode: 200,
			},
		},
		server: {
			auditPassed: true,
			departments: serverEvidence(
				"appointmentDepartments",
				"3333333333333333333333333333333333333333333333333333333333333333",
			),
			schedules: serverEvidence(
				"appointmentSchedules",
				"4444444444444444444444444444444444444444444444444444444444444444",
			),
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
	test("全部域 pending 时允许先做清单结构审计，但不产生通过结论", () => {
		const manifest = completeManifest();
		expect(isPendingDeviceEvidenceManifest(manifest)).toBe(true);
		expect(auditDeviceEvidence(manifest, manifest.candidate).passed).toBe(
			false,
		);

		manifest.domains.auth = passedEvidence();
		expect(isPendingDeviceEvidenceManifest(manifest)).toBe(false);
	});

	test("允许当前候选的全量 pending 清单，并安全输出摘要", () => {
		const result = auditDeviceEvidence(completeManifest());
		expect(result.passed).toBe(false);
		expect(Object.keys(result.domains)).toHaveLength(9);
		expect(result.domains.auth.reasonRecorded).toBe(true);
	});

	test("普通资料域必须同时证明 GET 读取和 PUT 更新", () => {
		const manifest = completeManifest();
		manifest.domains.profileReadonlyWrite = profilePassedEvidence();
		const result = auditDeviceEvidence(manifest);
		expect(result.passed).toBe(false);
		expect(result.domains.profileReadonlyWrite.result).toBe("passed");

		manifest.domains.profileReadonlyWrite.client.update.method = "GET";
		expect(() => auditDeviceEvidence(manifest)).toThrow("method 必须是 PUT");

		const failedManifest = completeManifest();
		failedManifest.domains.profileReadonlyWrite = profilePassedEvidence();
		failedManifest.domains.profileReadonlyWrite.result = "failed";
		failedManifest.domains.profileReadonlyWrite.requiredScenarios = [
			...DOMAIN_REQUIRED_SCENARIOS.profileReadonlyWrite,
		];
		failedManifest.domains.profileReadonlyWrite.client.update.method = "GET";
		expect(() => auditDeviceEvidence(failedManifest)).toThrow(
			"method 必须是 PUT",
		);
	});

	test("普通资料双请求必须使用不同的客户端和服务端关联证据", () => {
		const clientManifest = completeManifest();
		clientManifest.domains.profileReadonlyWrite = profilePassedEvidence();
		clientManifest.domains.profileReadonlyWrite.client.update.requestId =
			clientManifest.domains.profileReadonlyWrite.client.read.requestId;
		expect(() => auditDeviceEvidence(clientManifest)).toThrow(
			"必须使用不同的 requestId/traceId",
		);

		const serverManifest = completeManifest();
		serverManifest.domains.profileReadonlyWrite = profilePassedEvidence();
		serverManifest.domains.profileReadonlyWrite.server.update.correlationFingerprint =
			serverManifest.domains.profileReadonlyWrite.server.read.correlationFingerprint;
		expect(() => auditDeviceEvidence(serverManifest)).toThrow(
			"必须使用不同的关联指纹",
		);
	});

	test("预约目录域必须同时证明科室和排班两个只读请求", () => {
		const manifest = completeManifest();
		manifest.domains.appointmentDirectory =
			appointmentDirectoryPassedEvidence();
		const result = auditDeviceEvidence(manifest);
		expect(result.passed).toBe(false);
		expect(result.domains.appointmentDirectory.result).toBe("passed");

		manifest.domains.appointmentDirectory.client.schedules.path =
			"/api/v2/appointments/departments";
		expect(() => auditDeviceEvidence(manifest)).toThrow(
			"schedules.path 必须是 /api/v2/appointments/schedules",
		);

		const failedManifest = completeManifest();
		failedManifest.domains.appointmentDirectory =
			appointmentDirectoryPassedEvidence();
		failedManifest.domains.appointmentDirectory.result = "failed";
		failedManifest.domains.appointmentDirectory.requiredScenarios = [
			...DOMAIN_REQUIRED_SCENARIOS.appointmentDirectory,
		];
		failedManifest.domains.appointmentDirectory.client.schedules.statusCode = 503;
		const failedResult = auditDeviceEvidence(failedManifest);
		expect(failedResult.domains.appointmentDirectory.result).toBe("failed");
	});

	test("预约目录双请求必须使用不同的客户端和服务端关联证据", () => {
		const clientManifest = completeManifest();
		clientManifest.domains.appointmentDirectory =
			appointmentDirectoryPassedEvidence();
		clientManifest.domains.appointmentDirectory.client.schedules.requestId =
			clientManifest.domains.appointmentDirectory.client.departments.requestId;
		expect(() => auditDeviceEvidence(clientManifest)).toThrow(
			"必须使用不同的 requestId/traceId",
		);

		const serverManifest = completeManifest();
		serverManifest.domains.appointmentDirectory =
			appointmentDirectoryPassedEvidence();
		serverManifest.domains.appointmentDirectory.server.schedules.correlationFingerprint =
			serverManifest.domains.appointmentDirectory.server.departments.correlationFingerprint;
		expect(() => auditDeviceEvidence(serverManifest)).toThrow(
			"必须使用不同的关联指纹",
		);
	});

	test("只有页面、客户端和同链服务端证据齐全时才允许 passed", () => {
		const manifest = completeManifest();
		manifest.domains.auth = passedEvidence();
		const result = auditDeviceEvidence(manifest);
		expect(result.passed).toBe(false);
		expect(result.domains.auth.result).toBe("passed");

		manifest.domains.patientDirectory = passedEvidence("patientDirectory");
		manifest.domains.patientDirectory.client.statusCode = 401;
		expect(() => auditDeviceEvidence(manifest)).toThrow(
			"客户端 HTTP 必须为 2xx",
		);
	});

	test("单请求业务域不能用其它公共接口的成功响应冒充", () => {
		const manifest = completeManifest();
		manifest.domains.patientDirectory = passedEvidence("patientDirectory");
		manifest.domains.patientDirectory.client.path = "/api/v2/me";
		expect(() => auditDeviceEvidence(manifest)).toThrow(
			"patientDirectory.client.path 必须是 /api/v2/patients",
		);

		const methodManifest = completeManifest();
		methodManifest.domains.auth = passedEvidence("auth");
		methodManifest.domains.auth.client.method = "GET";
		expect(() => auditDeviceEvidence(methodManifest)).toThrow(
			"auth.client.method 必须是 POST",
		);

		const syncManifest = completeManifest();
		syncManifest.domains.patientDirectorySync = passedEvidence(
			"patientDirectorySync",
		);
		const syncResult = auditDeviceEvidence(syncManifest);
		expect(syncResult.domains.patientDirectorySync.result).toBe("passed");
		syncManifest.domains.patientDirectorySync.client.method = "GET";
		expect(() => auditDeviceEvidence(syncManifest)).toThrow(
			"patientDirectorySync.client.method 必须是 POST",
		);

		const serverManifest = completeManifest();
		serverManifest.domains.patientDirectory =
			passedEvidence("patientDirectory");
		serverManifest.domains.patientDirectory.server.businessDomain = "auth";
		expect(() => auditDeviceEvidence(serverManifest)).toThrow(
			"patientDirectory.server.businessDomain 必须是 patientRead",
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

	test("拒绝把页面摘要中的手机号写进证据", () => {
		const labeledPhoneManifest = completeManifest();
		labeledPhoneManifest.domains.auth = passedEvidence();
		labeledPhoneManifest.domains.auth.page.summary =
			"登录页面显示手机号：13800138000";
		expect(() => auditDeviceEvidence(labeledPhoneManifest)).toThrow("敏感内容");

		const barePhoneManifest = completeManifest();
		barePhoneManifest.domains.auth = passedEvidence();
		barePhoneManifest.domains.auth.page.summary = "页面显示 13800138000";
		expect(() => auditDeviceEvidence(barePhoneManifest)).toThrow("敏感内容");
	});

	test("拒绝不带公共版本前缀或查询参数的客户端路径", () => {
		const manifest = completeManifest();
		manifest.domains.auth = passedEvidence();
		manifest.domains.auth.client.path = "/auth/wechat";
		expect(() => auditDeviceEvidence(manifest)).toThrow("公共 /api/v2 路径");
	});

	test("通过项必须覆盖该业务域的全部固定场景", () => {
		const manifest = completeManifest();
		manifest.domains.auth = passedEvidence();
		manifest.domains.auth.scenarios = ["success"];
		expect(() => auditDeviceEvidence(manifest)).toThrow(
			"auth.scenarios 缺少 unauthorized",
		);
	});

	test("pending 项必须保留可执行的固定场景待办", () => {
		const manifest = completeManifest();
		manifest.domains.patientDirectory.requiredScenarios = ["success-non-empty"];
		expect(() => auditDeviceEvidence(manifest)).toThrow(
			"patientDirectory.requiredScenarios 缺少 success-empty",
		);
	});
});
