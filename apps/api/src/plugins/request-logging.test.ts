import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import { DependencyNotConfiguredError } from "@hospital/domain";
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
