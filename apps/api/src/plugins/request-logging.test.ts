import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import {
	DependencyNotConfiguredError,
	ExternalTraceReadModelValidationError,
	PatientDirectorySnapshotResultValidationError,
	PaymentOrderReadModelValidationError,
} from "@hospital/domain";
import { PersistenceUnavailableError } from "@hospital/persistence";
import { SessionPrincipalReadModelValidationError } from "../modules/auth/service";
import { safeErrorMetadata } from "./request-logging";

test("请求日志保留 provider 诊断字段但不保留原始报文", () => {
	const error = new ProviderRequestError({
		provider: "zhongyang",
		operation: "appointment-departments",
		requestId: "provider-request-001",
		statusCode: 502,
		retryable: true,
		message: "provider raw response contains sensitive fields",
	});

	expect(safeErrorMetadata(error, "UNKNOWN")).toEqual({
		errorName: "ProviderRequestError",
		errorCode: "UNKNOWN",
		provider: "zhongyang",
		providerOperation: "appointment-departments",
		providerRequestId: "provider-request-001",
		providerStatusCode: 502,
		providerRetryable: true,
	});
	expect(JSON.stringify(safeErrorMetadata(error, "UNKNOWN"))).not.toContain(
		"provider raw response",
	);
});

test("依赖未配置时日志标记具体依赖而不是打印配置值", () => {
	const metadata = safeErrorMetadata(
		new DependencyNotConfiguredError("zhongyang-appointment-directory"),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "DependencyNotConfiguredError",
		errorCode: "UNKNOWN",
		dependency: "zhongyang-appointment-directory",
	});
});

test("持久化瞬态故障只记录操作和允许列表错误码", () => {
	const cause = Object.assign(new Error("连接串和 SQL 不得进入日志"), {
		code: "PROTOCOL_CONNECTION_LOST",
	});
	const metadata = safeErrorMetadata(
		new PersistenceUnavailableError("read", cause),
		"UNKNOWN",
	);

	expect(metadata).toEqual({
		errorName: "PersistenceUnavailableError",
		errorCode: "UNKNOWN",
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
		errorCode: "UNKNOWN",
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
