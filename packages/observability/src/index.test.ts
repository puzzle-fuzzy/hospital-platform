import { expect, test } from "bun:test";
import { createLogger } from "./index";

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
			idempotencyKey: "payment-key",
			nested: { token: "nested-secret", count: 1 },
			providerSubject: "openid-001",
			identity: { provider_subject: "openid-002" },
			unionId: "unionid-001",
			providerPatientId: "provider-patient-001",
			provider: { provider_patient_id: "provider-patient-002" },
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
		idempotencyKey: "[REDACTED]",
		nested: { token: "[REDACTED]", count: 1 },
		providerSubject: "[REDACTED]",
		identity: { provider_subject: "[REDACTED]" },
		unionId: "[REDACTED]",
		providerPatientId: "[REDACTED]",
		provider: { provider_patient_id: "[REDACTED]" },
		payment: {
			prepayId: "[REDACTED]",
			payParams: "[REDACTED]",
			providerTransactionId: "transaction-001",
		},
		credentials: { appSecret: "[REDACTED]", privateKey: "[REDACTED]" },
		msg: "request completed",
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
