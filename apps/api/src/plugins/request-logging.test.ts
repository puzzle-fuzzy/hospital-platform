import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import {
	DependencyNotConfiguredError,
	ExternalTraceReadModelValidationError,
	IdentityUserReadModelValidationError,
	PatientDirectorySnapshotResultValidationError,
	PaymentOrderReadModelValidationError,
	UserProfileReadModelValidationError,
} from "@hospital/domain";
import { PersistenceUnavailableError } from "@hospital/persistence";
import { HttpError } from "../errors";
import { SessionPrincipalReadModelValidationError } from "../modules/auth/service";
import { safeErrorMetadata } from "./request-logging";

test("请求日志把可重试 Provider 失败映射为稳定业务错误码", () => {
	const error = new ProviderRequestError({
		provider: "zhongyang",
		operation: "appointment-departments",
		requestId: "provider-request-001",
		statusCode: 502,
		retryable: true,
		failureStage: "http",
		message: "provider raw response contains sensitive fields",
	});

	expect(safeErrorMetadata(error, "UNKNOWN")).toEqual({
		errorName: "ProviderRequestError",
		errorCode: "provider-temporarily-unavailable",
		provider: "zhongyang",
		providerOperation: "appointment-departments",
		providerRequestId: "provider-request-001",
		providerStatusCode: 502,
		providerRetryable: true,
		providerFailureStage: "http",
	});
	expect(JSON.stringify(safeErrorMetadata(error, "UNKNOWN"))).not.toContain(
		"provider raw response",
	);
});

test("请求日志保留证书过期的白名单诊断码但不记录异常原文", () => {
	const error = new ProviderRequestError({
		provider: "zhongyang",
		operation: "appointment-records",
		retryable: true,
		failureStage: "transport",
		message: "certificate details must not enter logs",
		cause: Object.assign(new Error("expired certificate"), {
			code: "CERT_HAS_EXPIRED",
		}),
	});

	const metadata = safeErrorMetadata(error, "UNKNOWN");
	expect(metadata).toMatchObject({
		errorCode: "provider-temporarily-unavailable",
		providerFailureStage: "transport",
		providerTransportErrorCode: "CERT_HAS_EXPIRED",
	});
	expect(JSON.stringify(metadata)).not.toContain("expired certificate");
});

test("请求日志区分 Provider 响应非法和主动拒绝", () => {
	const invalidResponse = new ProviderRequestError({
		provider: "zhongyang",
		operation: "reports-directory",
		requestId: "invalid-response-request",
		retryable: false,
		responseInvalid: true,
		message: "invalid response",
	});
	const rejected = new ProviderRequestError({
		provider: "zhongyang",
		operation: "reports-directory",
		requestId: "rejected-request",
		retryable: false,
		message: "request rejected",
	});

	expect(safeErrorMetadata(invalidResponse, "UNKNOWN").errorCode).toBe(
		"provider-response-invalid",
	);
	expect(safeErrorMetadata(rejected, "UNKNOWN").errorCode).toBe(
		"provider-request-rejected",
	);
});

test("请求日志优先采用 HttpError 的稳定业务错误码", () => {
	const metadata = safeErrorMetadata(
		new HttpError(401, "unauthorized", "请先登录"),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "HttpError",
		errorCode: "unauthorized",
	});
});

test("依赖未配置时日志标记具体依赖而不是打印配置值", () => {
	const metadata = safeErrorMetadata(
		new DependencyNotConfiguredError("zhongyang-appointment-directory"),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "DependencyNotConfiguredError",
		errorCode: "dependency-not-configured",
		dependency: "zhongyang-appointment-directory",
	});
});

test("持久化瞬态故障只记录操作和允许列表错误码", () => {
	const cause = Object.assign(new Error("连接串和 SQL 不得进入日志"), {
		code: "PROTOCOL_CONNECTION_LOST",
	});
	const metadata = safeErrorMetadata(
		new PersistenceUnavailableError("read", cause, "mysql"),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "PersistenceUnavailableError",
		errorCode: "persistence-temporarily-unavailable",
		persistenceDependency: "mysql",
		persistenceOperation: "read",
		persistenceErrorCode: "PROTOCOL_CONNECTION_LOST",
	});
	expect(JSON.stringify(metadata)).not.toContain("连接串");
	expect(JSON.stringify(metadata)).not.toContain("SQL");
});

test("持久化日志拒绝未知或可能携带敏感信息的错误码", () => {
	const cause = Object.assign(new Error("敏感错误"), {
		code: "mysql://user:password@host/database",
	});
	const metadata = safeErrorMetadata(
		new PersistenceUnavailableError("write", cause),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "PersistenceUnavailableError",
		errorCode: "persistence-temporarily-unavailable",
		persistenceOperation: "write",
	});
});

test("支付读模型日志只保留固定违规原因", () => {
	const metadata = safeErrorMetadata(
		new PaymentOrderReadModelValidationError("amounts-invalid"),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "PaymentOrderReadModelValidationError",
		errorCode: "UNKNOWN",
		readModelViolation: "amounts-invalid",
	});
});

test("患者快照读模型日志只保留固定违规原因", () => {
	const metadata = safeErrorMetadata(
		new PatientDirectorySnapshotResultValidationError(
			"deactivated-count-invalid",
		),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "PatientDirectorySnapshotResultValidationError",
		errorCode: "UNKNOWN",
		readModelViolation: "deactivated-count-invalid",
	});
});

test("会话 principal 读模型日志只保留固定违规原因", () => {
	const metadata = safeErrorMetadata(
		new SessionPrincipalReadModelValidationError("user-id-invalid"),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "SessionPrincipalReadModelValidationError",
		errorCode: "UNKNOWN",
		readModelViolation: "user-id-invalid",
	});
});

test("Provider trace 读模型日志只保留固定违规原因", () => {
	const metadata = safeErrorMetadata(
		new ExternalTraceReadModelValidationError("request-id-invalid"),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "ExternalTraceReadModelValidationError",
		errorCode: "UNKNOWN",
		readModelViolation: "request-id-invalid",
	});
});

test("普通资料和身份读模型错误会进入 HTTP 失败日志的固定违规字段", () => {
	const profileMetadata = safeErrorMetadata(
		new UserProfileReadModelValidationError("profile-email-invalid"),
		"UNKNOWN",
	);
	const identityMetadata = safeErrorMetadata(
		new IdentityUserReadModelValidationError("user-id-invalid"),
		"UNKNOWN",
	);

	expect(profileMetadata).toMatchObject({
		errorName: "UserProfileReadModelValidationError",
		readModelViolation: "profile-email-invalid",
	});
	expect(identityMetadata).toMatchObject({
		errorName: "IdentityUserReadModelValidationError",
		readModelViolation: "user-id-invalid",
	});
	// 固定违规原因可以帮助定位持久化/会话读模型损坏，但不能把原始 userId、
	// 邮箱或其它个人字段带进请求日志。
	expect(JSON.stringify({ profileMetadata, identityMetadata })).not.toContain(
		"profile-user",
	);
});
