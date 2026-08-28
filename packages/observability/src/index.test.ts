import { expect, test } from "bun:test";
import {
	createLogger,
	providerFailureMetadata,
	redactSerializedLogLine,
} from "./index";

test("Provider 失败只提取可关联的低敏诊断字段", () => {
	const error = Object.assign(
		new Error("provider raw response contains patient data"),
		{
			name: "ProviderRequestError",
			provider: "zhongyang",
			operation: "appointment-departments",
			requestId: "provider-request-001",
			statusCode: 502,
			retryable: false,
			failureStage: "http",
		},
	);

	expect(providerFailureMetadata(error)).toEqual({
		provider: "zhongyang",
		providerOperation: "appointment-departments",
		providerRequestId: "provider-request-001",
		providerStatusCode: 502,
		providerRetryable: false,
		providerFailureStage: "http",
	});
	expect(JSON.stringify(providerFailureMetadata(error))).not.toContain(
		"patient data",
	);
});

test("Provider 失败的异常字段不越过日志白名单", () => {
	const error = Object.assign(new Error("sensitive"), {
		name: "ProviderRequestError",
		provider: "patient\nsecret",
		operation: "appointment-records",
		requestId: "x".repeat(129),
		statusCode: 700,
		retryable: "false",
	});

	expect(providerFailureMetadata(error)).toEqual({
		providerOperation: "appointment-records",
	});
});

test("pino emits JSON and redacts configured sensitive paths", () => {
	const lines: string[] = [];
	const destination = {
		write(chunk: string) {
			lines.push(chunk);
		},
	};
	const logger = createLogger({
		service: "test-service",
		environment: "test",
		level: "debug",
		destination,
	});

	logger.info(
		{
			event: "http.request.completed",
			traceId: "trace-001",
			requestId: "request-001",
			authorization: "Bearer secret-token",
			Authorization: "Bearer uppercase-secret-token",
			Cookie: "session=uppercase-secret-cookie",
			"Set-Cookie": "session=uppercase-set-cookie",
			"Idempotency-Key": "uppercase-idempotency-key",
			headers: {
				Authorization: "Bearer nested-uppercase-secret-token",
				Cookie: "nested-uppercase-cookie",
				"Set-Cookie": "nested-uppercase-set-cookie",
				"Idempotency-Key": "nested-uppercase-idempotency-key",
			},
			idempotencyKey: "payment-key",
			nested: { token: "nested-secret", count: 1 },
			providerSubject: "openid-001",
			identity: { provider_subject: "openid-002" },
			unionId: "unionid-001",
			providerPatientId: "provider-patient-001",
			provider: { provider_patient_id: "provider-patient-002" },
			providerArchive: {
				patId: "his-patient-001",
				patName: "档案患者",
				// 这里只能使用明确的合成值，不能把真实患者卡号、证件号或手机号带入仓库。
				cardNo: "synthetic-card-001",
				medicalCardNo: "synthetic-medical-card-001",
				idCardNo: "synthetic-id-card-001",
				IDCardNo: "synthetic-uppercase-id-card-001",
				idCard: "synthetic-id-card-short-001",
				address: "synthetic-address-001",
				birthday: "1990-01-01",
				phone: "synthetic-phone-001",
				patCardVOList: [{ patId: "his-patient-001" }],
				providerReferences: { "his-patient": "his-patient-001" },
			},
			payment: {
				prepayId: "wx-prepay-001",
				payParams: { paySign: "payment-signature", nonceStr: "nonce-001" },
				providerTransactionId: "transaction-001",
			},
			credentials: { appSecret: "app-secret", privateKey: "private-key" },
		},
		"request completed",
	);

	const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
	expect(record).toMatchObject({
		service: "test-service",
		environment: "test",
		event: "http.request.completed",
		traceId: "trace-001",
		requestId: "request-001",
		authorization: "[REDACTED]",
		Authorization: "[REDACTED]",
		Cookie: "[REDACTED]",
		"Set-Cookie": "[REDACTED]",
		"Idempotency-Key": "[REDACTED]",
		headers: {
			Authorization: "[REDACTED]",
			Cookie: "[REDACTED]",
			"Set-Cookie": "[REDACTED]",
			"Idempotency-Key": "[REDACTED]",
		},
		idempotencyKey: "[REDACTED]",
		nested: { token: "[REDACTED]", count: 1 },
		providerSubject: "[REDACTED]",
		identity: { provider_subject: "[REDACTED]" },
		unionId: "[REDACTED]",
		providerPatientId: "[REDACTED]",
		provider: { provider_patient_id: "[REDACTED]" },
		providerArchive: {
			patId: "[REDACTED]",
			patName: "[REDACTED]",
			cardNo: "[REDACTED]",
			medicalCardNo: "[REDACTED]",
			idCardNo: "[REDACTED]",
			IDCardNo: "[REDACTED]",
			idCard: "[REDACTED]",
			address: "[REDACTED]",
			birthday: "[REDACTED]",
			phone: "[REDACTED]",
			patCardVOList: "[REDACTED]",
			providerReferences: "[REDACTED]",
		},
		payment: {
			prepayId: "[REDACTED]",
			payParams: "[REDACTED]",
			providerTransactionId: "transaction-001",
		},
		credentials: { appSecret: "[REDACTED]", privateKey: "[REDACTED]" },
		msg: "request completed",
	});
});

test("pino 在多层 Provider 结构和 child binding 中递归脱敏", () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "test-service",
		environment: "test",
		level: "debug",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});

	// 这些字段模拟 Provider 原始结构可能出现的深层和数组嵌套，全部使用合成值。
	logger
		.child({
			context: {
				provider: {
					patient: { phone: "synthetic-child-phone" },
				},
			},
		})
		.info(
			{
				providerEnvelope: {
					data: {
						patient: {
							patId: "synthetic-deep-patient-id",
							contactTelephone: "synthetic-deep-contact",
						},
						cards: [
							{
								identity: { idCardNo: "synthetic-deep-id-card" },
							},
						],
					},
				},
				deepHeaders: {
					branch: {
						"set-cookie": "synthetic-deep-cookie",
						"IDEMPOTENCY-KEY": "synthetic-deep-idempotency-key",
					},
				},
			},
			"provider response inspected",
		);

	const serialized = lines[0] ?? "";
	// 先检查原值没有进入最终 JSON，再检查结构化字段确实被统一替换。
	for (const secret of [
		"synthetic-child-phone",
		"synthetic-deep-patient-id",
		"synthetic-deep-contact",
		"synthetic-deep-id-card",
		"synthetic-deep-cookie",
		"synthetic-deep-idempotency-key",
	]) {
		expect(serialized).not.toContain(secret);
	}

	const record = JSON.parse(serialized) as {
		context: { provider: { patient: { phone: string } } };
		providerEnvelope: {
			data: {
				patient: { patId: string; contactTelephone: string };
				cards: Array<{ identity: { idCardNo: string } }>;
			};
		};
		deepHeaders: {
			branch: {
				"set-cookie": string;
				"IDEMPOTENCY-KEY": string;
			};
		};
	};
	expect(record.context.provider.patient.phone).toBe("[REDACTED]");
	expect(record.providerEnvelope.data.patient).toMatchObject({
		patId: "[REDACTED]",
		contactTelephone: "[REDACTED]",
	});
	expect(record.providerEnvelope.data.cards[0]?.identity.idCardNo).toBe(
		"[REDACTED]",
	);
	expect(record.deepHeaders.branch).toEqual({
		"set-cookie": "[REDACTED]",
		"IDEMPOTENCY-KEY": "[REDACTED]",
	});
});

test("pino 递归脱敏 Provider 常见蛇形字段和原始报文容器", () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "test-service",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});

	// 这些字段模拟不同版本网关可能返回的命名风格和原始报文包装层；
	// 业务代码仍然禁止主动记录它们，这里只验证最终输出层不会放行原值。
	logger.info(
		{
			providerEnvelope: {
				patient_name: "synthetic-snake-patient",
				id_card_no: "synthetic-snake-id-card",
				mobile_phone: "synthetic-snake-phone",
				card_no: "synthetic-snake-card",
			},
			provider_raw_payload: {
				data: { email_address: "synthetic-snake-email" },
			},
			response_body: {
				pat_name: "synthetic-raw-patient",
			},
		},
		"provider response inspected",
	);

	const serialized = lines[0] ?? "";
	for (const secret of [
		"synthetic-snake-patient",
		"synthetic-snake-id-card",
		"synthetic-snake-phone",
		"synthetic-snake-card",
		"synthetic-snake-email",
		"synthetic-raw-patient",
	]) {
		expect(serialized).not.toContain(secret);
	}

	const record = JSON.parse(serialized) as {
		providerEnvelope: {
			patient_name: string;
			id_card_no: string;
			mobile_phone: string;
			card_no: string;
		};
		provider_raw_payload: string;
		response_body: string;
	};
	expect(record.providerEnvelope).toEqual({
		patient_name: "[REDACTED]",
		id_card_no: "[REDACTED]",
		mobile_phone: "[REDACTED]",
		card_no: "[REDACTED]",
	});
	expect(record.provider_raw_payload).toBe("[REDACTED]");
	expect(record.response_body).toBe("[REDACTED]");
});

test("序列化日志格式异常时丢弃原文并输出固定安全事件", () => {
	const line = redactSerializedLogLine(
		"invalid-log phone=synthetic-phone idCardNo=synthetic-id-card",
	);

	expect(line).not.toContain("synthetic-phone");
	expect(line).not.toContain("synthetic-id-card");
	expect(JSON.parse(line)).toEqual({
		level: 50,
		event: "log.redaction.failed",
		errorType: "serialized-json-invalid",
		msg: "Log record discarded by redaction boundary",
	});
});

test("pino honors the configured minimum level", () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "test-service",
		environment: "test",
		level: "warn",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});

	logger.info("ignored");
	logger.warn("kept");

	expect(lines).toHaveLength(1);
	expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ msg: "kept" });
});
