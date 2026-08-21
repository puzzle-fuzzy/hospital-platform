import { readFile } from "node:fs/promises";
import { auditCurrentReleaseConsistency } from "./release-baseline-audit.mjs";

/**
 * 真机三层证据的最小业务集合。
 *
 * 这里不把“页面存在”或“接口返回 200”当作迁移完成；每个通过项都必须
 * 同时拥有页面观察、客户端请求和服务端同链日志。支付、医保、预约写入、
 * HIS 回写等未开放能力故意不放进集合，避免验收工具反向打开业务 gate。
 */
const DOMAIN_LABELS = Object.freeze({
	auth: "微信登录与当前用户",
	patientDirectory: "首页患者目录",
	patientSelection: "显式更换就诊人",
	appointmentDirectory: "预约科室与排班",
	appointmentRecords: "我的挂号",
	missedAppointments: "爽约记录",
	outpatientPayment: "门诊缴费只读",
	profileReadonlyWrite: "普通资料读取与更新",
});

/**
 * 单请求域的公共入口白名单。
 *
 * 证据清单只保存不带查询参数的路径，避免把患者标识、日期和其它业务
 * 参数写入文档；但这不意味着可以接受任意 `/api/v2/` 请求。每个域仍然
 * 必须命中自己的真实路由，才能避免用 `/me` 的成功响应冒充患者目录或
 * 挂号结果。双请求域（预约目录、普通资料）在各自的专用校验中处理。
 */
const DOMAIN_CLIENT_REQUESTS = Object.freeze({
	auth: { method: "POST", path: "/api/v2/auth/wechat" },
	patientDirectory: { method: "GET", path: "/api/v2/patients" },
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
});

/**
 * 与 API request-context 的 requestIdPattern 保持同一安全边界。
 *
 * 小程序会主动发送 `mp-时间-随机串` 作为 x-request-id，服务端校验通过后
 * 原样回传并写入 traceId；服务端仅在客户端值缺失或非法时才生成 UUID。
 * 因此真机证据不能错误地只接受 UUID，也不能退化成接受任意可打印字符串。
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;
const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40}$/u;
const RELEASE_PATTERN = /^[0-9a-f]{7,40}$/u;

/** 字段名出现这些词时，即使值已经脱敏，也不允许进入证据文件。 */
const SENSITIVE_KEY_PATTERN =
	/(?:token|secret|authorization|cookie|openid|unionid|session[_-]?key|appsecret|password|passwd|idcard|身份证|手机号|phone|patid|thirdpatient|providerpatient|cardno|卡号|原始报文|raw(?:json|response)?)/iu;

/** 证据正文不能携带凭证、医疗身份号或把敏感参数拼进 URL。 */
const SENSITIVE_VALUE_PATTERNS = Object.freeze([
	/\bBearer\s+[A-Za-z0-9._~-]+/iu,
	/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
	/(?:openid|unionid|session[_-]?key|appsecret|authorization|idcard|cardno|patid)\s*[:=]/iu,
	/[?&](?:code|token|secret|openid|unionid|idCard|cardNo|patId)=[^&\s]+/iu,
	/\b\d{15,19}\b/u,
]);

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value) {
	return Number.isSafeInteger(value) && value >= 0;
}

function requirePlainObject(value, message) {
	if (!isPlainObject(value)) throw new Error(message);
	return value;
}

function requireNonEmptyString(value, message) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(message);
	}
	return value.trim();
}

function requireIsoDate(value, message) {
	const text = requireNonEmptyString(value, message);
	if (Number.isNaN(Date.parse(text))) throw new Error(message);
	return text;
}

/**
 * 递归扫描证据对象，拒绝把 token、身份证号、完整卡号或 Provider 原文带入
 * 文档。错误只返回固定位置，不返回命中的原文，避免审计工具二次泄露。
 */
function assertNoSensitiveFields(value, path = "$") {
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			assertNoSensitiveFields(item, `${path}[${index}]`);
		});
		return;
	}
	if (!isPlainObject(value)) {
		if (
			typeof value === "string" &&
			SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))
		) {
			throw new Error(`证据文件包含敏感内容：${path}`);
		}
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if (SENSITIVE_KEY_PATTERN.test(key)) {
			throw new Error(`证据文件包含敏感字段：${path}.${key}`);
		}
		assertNoSensitiveFields(child, `${path}.${key}`);
	}
}

function validateCandidate(candidate, expectedCandidate) {
	const object = requirePlainObject(candidate, "证据文件缺少 candidate");
	const serverRelease = requireNonEmptyString(
		object.serverRelease,
		"candidate.serverRelease 必须是 release 短提交",
	);
	const miniProgramCommit = requireNonEmptyString(
		object.miniProgramCommit,
		"candidate.miniProgramCommit 必须是小程序提交",
	);
	const sourceRevision = requireNonEmptyString(
		object.sourceRevision,
		"candidate.sourceRevision 必须是完整运行包来源",
	);
	if (!RELEASE_PATTERN.test(serverRelease)) {
		throw new Error("candidate.serverRelease 不是合法的 Git release 形状");
	}
	if (!/^[0-9a-f]{7,40}$/u.test(miniProgramCommit)) {
		throw new Error("candidate.miniProgramCommit 不是合法的 Git 提交形状");
	}
	if (!SOURCE_REVISION_PATTERN.test(sourceRevision)) {
		throw new Error("candidate.sourceRevision 必须是 40 位十六进制指纹");
	}
	if (!sourceRevision.startsWith(miniProgramCommit)) {
		throw new Error("candidate.sourceRevision 必须以 miniProgramCommit 开头");
	}
	if (expectedCandidate) {
		// 发布基线的公共返回名是 `miniProgramSourceRevision`，证据 JSON 为了
		// 保持短字段使用 `sourceRevision`。这里显式建立映射，不能用动态字段
		// 拼接，否则当前候选会因为命名差异被错误拒绝，旧候选也可能绕过比较。
		const expectedValues = {
			serverRelease: expectedCandidate.serverRelease,
			miniProgramCommit: expectedCandidate.miniProgramCommit,
			sourceRevision:
				expectedCandidate.sourceRevision ??
				expectedCandidate.miniProgramSourceRevision,
		};
		for (const field of [
			"serverRelease",
			"miniProgramCommit",
			"sourceRevision",
		]) {
			if (object[field] !== expectedValues[field]) {
				throw new Error(
					`candidate.${field} 与当前发布基线不一致，不能纳入真机证据`,
				);
			}
		}
	}
	return { serverRelease, miniProgramCommit, sourceRevision };
}

function validatePageEvidence(page, domain) {
	const object = requirePlainObject(page, `${domain}.page 缺失`);
	if (object.screenshot !== true) {
		throw new Error(`${domain}.page.screenshot 必须为 true`);
	}
	const observedAt = requireIsoDate(
		object.observedAt,
		`${domain}.page.observedAt 必须是 ISO 时间`,
	);
	const summary = requireNonEmptyString(
		object.summary,
		`${domain}.page.summary 缺失`,
	);
	return { observedAt, summaryRecorded: summary.length > 0 };
}

function validateClientEvidence(client, domain) {
	const object = requirePlainObject(client, `${domain}.client 缺失`);
	const requestId = object.requestId ?? object.traceId;
	if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) {
		throw new Error(`${domain}.client 必须提供安全有界的 requestId 或 traceId`);
	}
	const path = requireNonEmptyString(object.path, `${domain}.client.path 缺失`);
	if (!path.startsWith("/api/v2/") || path.includes("?")) {
		throw new Error(
			`${domain}.client.path 必须是无查询参数的公共 /api/v2 路径`,
		);
	}
	if (
		!Number.isInteger(object.statusCode) ||
		object.statusCode < 100 ||
		object.statusCode > 599
	) {
		throw new Error(`${domain}.client.statusCode 不是合法 HTTP 状态码`);
	}
	return { statusCode: object.statusCode };
}

function validateServerEvidence(server, domain) {
	const object = requirePlainObject(server, `${domain}.server 缺失`);
	if (typeof object.auditPassed !== "boolean") {
		throw new Error(`${domain}.server.auditPassed 必须为布尔值`);
	}
	if (
		typeof object.correlationFingerprint !== "string" ||
		!SHA256_PATTERN.test(object.correlationFingerprint)
	) {
		throw new Error(
			`${domain}.server.correlationFingerprint 必须是 SHA-256 指纹`,
		);
	}
	for (const key of ["requested", "succeeded", "http2xx", "failed"]) {
		if (!isNonNegativeSafeInteger(object[key])) {
			throw new Error(`${domain}.server.${key} 必须是非负安全整数`);
		}
	}
	return object;
}

/**
 * 普通资料不是单次查询：真机验收至少要分别证明 GET 读取和 PUT 更新。
 * 两条请求虽然使用同一个公共路径，但方法、requestId 和服务端关联链都
 * 不同；如果把它们压成一个计数，很容易把 GET 成功误当成 PUT 已保存。
 */
function validateProfileClientRequest(
	client,
	domain,
	operation,
	method,
	requireSuccess,
) {
	const source = requirePlainObject(
		client,
		`${domain}.client.${operation} 缺失`,
	);
	const evidence = validateClientEvidence(
		source,
		`${domain}.client.${operation}`,
	);
	if (source.path !== "/api/v2/me/profile") {
		throw new Error(
			`${domain}.client.${operation}.path 必须是 /api/v2/me/profile`,
		);
	}
	if (source.method !== method) {
		throw new Error(`${domain}.client.${operation}.method 必须是 ${method}`);
	}
	if (
		requireSuccess &&
		(evidence.statusCode < 200 || evidence.statusCode > 299)
	) {
		throw new Error(`${domain}.client.${operation} 标记 passed 时必须为 2xx`);
	}
	return evidence;
}

function validateProfileClientEvidence(client, domain, requireSuccess = true) {
	const object = requirePlainObject(client, `${domain}.client 缺失`);
	const read = validateProfileClientRequest(
		object.read,
		domain,
		"read",
		"GET",
		requireSuccess,
	);
	const update = validateProfileClientRequest(
		object.update,
		domain,
		"update",
		"PUT",
		requireSuccess,
	);
	return { read, update };
}

/** 普通资料的 GET/PUT 各自必须有独立的低敏服务端关联摘要。 */
function validateProfileServerEvidence(server, domain) {
	const object = requirePlainObject(server, `${domain}.server 缺失`);
	if (typeof object.auditPassed !== "boolean") {
		throw new Error(`${domain}.server.auditPassed 必须为布尔值`);
	}
	const read = validateServerEvidence(object.read, `${domain}.server.read`);
	const update = validateServerEvidence(
		object.update,
		`${domain}.server.update`,
	);
	return { auditPassed: object.auditPassed, read, update };
}

/**
 * 预约目录也是双请求业务：先读取科室，再按当前科室读取排班和号源。
 * 不能只记录排班成功，因为没有对应的科室请求就无法证明排班属于当前
 * 候选的目录链；同样不能把科室目录 200 当成排班已经可用。
 */
function validateAppointmentDirectoryClientRequest(
	client,
	domain,
	operation,
	path,
	requireSuccess,
) {
	const source = requirePlainObject(
		client,
		`${domain}.client.${operation} 缺失`,
	);
	const evidence = validateClientEvidence(
		source,
		`${domain}.client.${operation}`,
	);
	if (source.path !== path) {
		throw new Error(`${domain}.client.${operation}.path 必须是 ${path}`);
	}
	if (source.method !== "GET") {
		throw new Error(`${domain}.client.${operation}.method 必须是 GET`);
	}
	if (
		requireSuccess &&
		(evidence.statusCode < 200 || evidence.statusCode > 299)
	) {
		throw new Error(`${domain}.client.${operation} 标记 passed 时必须为 2xx`);
	}
	return evidence;
}

function validateAppointmentDirectoryClientEvidence(
	client,
	domain,
	requireSuccess = true,
) {
	const object = requirePlainObject(client, `${domain}.client 缺失`);
	const departments = validateAppointmentDirectoryClientRequest(
		object.departments,
		domain,
		"departments",
		"/api/v2/appointments/departments",
		requireSuccess,
	);
	const schedules = validateAppointmentDirectoryClientRequest(
		object.schedules,
		domain,
		"schedules",
		"/api/v2/appointments/schedules",
		requireSuccess,
	);
	return { departments, schedules };
}

/** 科室和排班各自保留服务端关联摘要，避免把两条请求压成一个计数。 */
function validateAppointmentDirectoryServerEvidence(server, domain) {
	const object = requirePlainObject(server, `${domain}.server 缺失`);
	if (typeof object.auditPassed !== "boolean") {
		throw new Error(`${domain}.server.auditPassed 必须为布尔值`);
	}
	const departments = validateServerEvidence(
		object.departments,
		`${domain}.server.departments`,
	);
	const schedules = validateServerEvidence(
		object.schedules,
		`${domain}.server.schedules`,
	);
	return { auditPassed: object.auditPassed, departments, schedules };
}

function validatePassedAppointmentDirectoryDomain(domain, evidence) {
	const page = validatePageEvidence(evidence.page, domain);
	const client = validateAppointmentDirectoryClientEvidence(
		evidence.client,
		domain,
	);
	const server = validateAppointmentDirectoryServerEvidence(
		evidence.server,
		domain,
	);
	for (const [operation, summary] of [
		["departments", server.departments],
		["schedules", server.schedules],
	]) {
		if (
			server.auditPassed !== true ||
			summary.requested < 1 ||
			summary.succeeded < 1 ||
			summary.http2xx < 1 ||
			summary.failed !== 0
		) {
			throw new Error(
				`${domain}.${operation} 缺少同链 requested/succeeded/http2xx 或存在失败事件`,
			);
		}
	}
	return { result: "passed", page, client, server };
}

function validateFailedAppointmentDirectoryDomain(domain, evidence) {
	validatePageEvidence(evidence.page, domain);
	const client = validateAppointmentDirectoryClientEvidence(
		evidence.client,
		domain,
		false,
	);
	const server = validateAppointmentDirectoryServerEvidence(
		evidence.server,
		domain,
	);
	const clientSucceeded = Object.values(client).every(
		({ statusCode }) => statusCode >= 200 && statusCode <= 299,
	);
	const serverFailed = Object.values(server)
		.filter((value) => isPlainObject(value) && "failed" in value)
		.some((value) => value.failed > 0);
	if (clientSucceeded && !serverFailed) {
		throw new Error(
			`${domain} 标记 failed 时必须保留科室或排班失败状态，不能与成功链矛盾`,
		);
	}
	return {
		result: "failed",
		pageObserved: true,
		departmentsStatusCode: client.departments.statusCode,
		schedulesStatusCode: client.schedules.statusCode,
	};
}

function validatePassedProfileDomain(domain, evidence) {
	const page = validatePageEvidence(evidence.page, domain);
	const client = validateProfileClientEvidence(evidence.client, domain);
	const server = validateProfileServerEvidence(evidence.server, domain);
	for (const [operation, summary] of [
		["read", server.read],
		["update", server.update],
	]) {
		if (
			server.auditPassed !== true ||
			summary.requested < 1 ||
			summary.succeeded < 1 ||
			summary.http2xx < 1 ||
			summary.failed !== 0
		) {
			throw new Error(
				`${domain}.${operation} 缺少同链 requested/succeeded/http2xx 或存在失败事件`,
			);
		}
	}
	return {
		result: "passed",
		page,
		client,
		server,
	};
}

function validateFailedProfileDomain(domain, evidence) {
	validatePageEvidence(evidence.page, domain);
	const client = validateProfileClientEvidence(evidence.client, domain, false);
	const { read, update } = client;
	const server = validateProfileServerEvidence(evidence.server, domain);
	if (
		read.statusCode >= 200 &&
		read.statusCode <= 299 &&
		update.statusCode >= 200 &&
		update.statusCode <= 299 &&
		server.read.failed === 0 &&
		server.update.failed === 0
	) {
		throw new Error(
			`${domain} 标记 failed 时必须保留读取或更新失败状态，不能与成功链矛盾`,
		);
	}
	return {
		result: "failed",
		pageObserved: true,
		readStatusCode: read.statusCode,
		updateStatusCode: update.statusCode,
	};
}

/** 校验普通单请求域的真实 HTTP 方法和路由，不接受其它业务的成功响应。 */
function validateDomainClientEvidence(client, domain, requireSuccess) {
	const expected = DOMAIN_CLIENT_REQUESTS[domain];
	if (!expected) {
		throw new Error(`${domain} 没有单请求入口 contract`);
	}
	const source = requirePlainObject(client, `${domain}.client 缺失`);
	const evidence = validateClientEvidence(source, `${domain}.client`);
	if (source.method !== expected.method) {
		throw new Error(`${domain}.client.method 必须是 ${expected.method}`);
	}
	if (source.path !== expected.path) {
		throw new Error(`${domain}.client.path 必须是 ${expected.path}`);
	}
	if (
		requireSuccess &&
		(evidence.statusCode < 200 || evidence.statusCode > 299)
	) {
		throw new Error(`${domain} 标记 passed 时客户端 HTTP 必须为 2xx`);
	}
	return evidence;
}

function validatePassedDomain(domain, evidence) {
	const page = validatePageEvidence(evidence.page, domain);
	const client = validateDomainClientEvidence(evidence.client, domain, true);
	const server = validateServerEvidence(evidence.server, domain);
	if (client.statusCode < 200 || client.statusCode > 299) {
		throw new Error(`${domain} 标记 passed 时客户端 HTTP 必须为 2xx`);
	}
	if (
		server.auditPassed !== true ||
		server.requested < 1 ||
		server.succeeded < 1 ||
		server.http2xx < 1 ||
		server.failed !== 0
	) {
		throw new Error(
			`${domain} 缺少同链 requested/succeeded/http2xx 或存在失败事件`,
		);
	}
	return { result: "passed", page, statusCode: client.statusCode };
}

function validateFailedDomain(domain, evidence) {
	validatePageEvidence(evidence.page, domain);
	const client = validateDomainClientEvidence(evidence.client, domain, false);
	const server = validateServerEvidence(evidence.server, domain);
	if (
		client.statusCode >= 200 &&
		client.statusCode <= 299 &&
		server.failed === 0
	) {
		throw new Error(
			`${domain} 标记 failed 时必须保留失败状态，不能与成功链矛盾`,
		);
	}
	return {
		result: "failed",
		pageObserved: true,
		statusCode: client.statusCode,
	};
}

/**
 * 校验脱敏后的真机证据清单，并只返回可写入文档的安全摘要。
 * `passed` 不是“页面能打开”，而是三层证据和候选来源同时一致。
 */
export function auditDeviceEvidence(manifest, expectedCandidate) {
	const root = requirePlainObject(manifest, "真机证据必须是 JSON 对象");
	assertNoSensitiveFields(root);
	const candidate = validateCandidate(root.candidate, expectedCandidate);
	const startedAt = requireIsoDate(root.startedAt, "startedAt 必须是 ISO 时间");
	const domains = requirePlainObject(root.domains, "证据文件缺少 domains");
	const actualDomains = Object.keys(domains);
	const expectedDomains = Object.keys(DOMAIN_LABELS);
	if (
		actualDomains.length !== expectedDomains.length ||
		actualDomains.some((domain) => !DOMAIN_LABELS[domain])
	) {
		throw new Error("domains 必须恰好覆盖当前 P0 真机业务集合");
	}

	const results = {};
	for (const domain of expectedDomains) {
		const evidence = requirePlainObject(domains[domain], `${domain} 证据缺失`);
		const result = evidence.result;
		if (result === "pending") {
			const reason = requireNonEmptyString(
				evidence.reason,
				`${domain}.reason 缺失`,
			);
			results[domain] = {
				label: DOMAIN_LABELS[domain],
				result,
				reasonRecorded: reason.length > 0,
			};
			continue;
		}
		if (result === "passed") {
			if (domain === "appointmentDirectory") {
				results[domain] = {
					label: DOMAIN_LABELS[domain],
					...validatePassedAppointmentDirectoryDomain(domain, evidence),
				};
				continue;
			}
			if (domain === "profileReadonlyWrite") {
				results[domain] = {
					label: DOMAIN_LABELS[domain],
					...validatePassedProfileDomain(domain, evidence),
				};
				continue;
			}
			results[domain] = {
				label: DOMAIN_LABELS[domain],
				...validatePassedDomain(domain, evidence),
			};
			continue;
		}
		if (result === "failed") {
			if (domain === "appointmentDirectory") {
				results[domain] = {
					label: DOMAIN_LABELS[domain],
					...validateFailedAppointmentDirectoryDomain(domain, evidence),
				};
				continue;
			}
			if (domain === "profileReadonlyWrite") {
				results[domain] = {
					label: DOMAIN_LABELS[domain],
					...validateFailedProfileDomain(domain, evidence),
				};
				continue;
			}
			results[domain] = {
				label: DOMAIN_LABELS[domain],
				...validateFailedDomain(domain, evidence),
			};
			continue;
		}
		throw new Error(`${domain}.result 只能是 pending、passed 或 failed`);
	}

	return {
		passed: Object.values(results).every(
			(result) => result.result === "passed",
		),
		candidate,
		startedAt,
		domains: results,
	};
}

function flagValue(flag) {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readManifest() {
	const file = flagValue("--file");
	const input = file
		? await readFile(file, "utf8")
		: await new Response(Bun.stdin).text();
	const normalized = input.replace(/^\uFEFF/u, "").trim();
	if (!normalized)
		throw new Error("未提供真机证据 JSON；请使用 --file 或标准输入");
	try {
		return JSON.parse(normalized);
	} catch {
		throw new Error("真机证据不是有效 JSON；请只提交脱敏证据清单");
	}
}

if (import.meta.main) {
	try {
		/**
		 * CLI 入口必须绑定仓库当前发布基线；否则旧二维码只要字段格式合法，
		 * 就可能在脱敏和三层统计都齐全时被误报为当前候选已通过。单元测试
		 * 仍可传入显式 expectedCandidate，保持纯函数边界和历史样例可复用。
		 */
		const baseline = await auditCurrentReleaseConsistency();
		if (!baseline.passed) {
			throw new Error(
				`当前发布基线未通过，不能审计真机证据（${baseline.failures.length} 项）`,
			);
		}
		const result = auditDeviceEvidence(await readManifest(), baseline);
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		console.error(
			`真机证据审计失败：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
