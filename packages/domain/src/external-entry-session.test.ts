import { expect, test } from "bun:test";
import {
	consumeExternalEntrySession,
	ExternalEntrySessionConsumeError,
	ExternalEntrySessionValidationError,
	evaluateExternalEntrySession,
	normalizeExternalEntrySession,
	revokeExternalEntrySession,
} from "./external-entry-session";

const issuedAt = "2026-08-26T00:00:00.000Z";
const expiresAt = "2026-08-26T00:05:00.000Z";
const now = new Date("2026-08-26T00:01:00.000Z");

function validSession() {
	return {
		sessionId: "session-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		audience: "report-share",
		resourceKey: "report-share-entry",
		scope: ["report:share"],
		issuedAt,
		expiresAt,
		status: "issued",
	};
}

function context(overrides: Record<string, unknown> = {}) {
	return {
		ownerUserId: "user-001",
		patientId: "patient-001",
		audience: "report-share" as const,
		resourceKey: "report-share-entry",
		now,
		...overrides,
	};
}

test("外部会话必须同时匹配 owner、患者、audience 和 resource", () => {
	const decision = evaluateExternalEntrySession(validSession(), context());
	expect(decision).toEqual({
		allowed: true,
		session: expect.objectContaining({
			sessionId: "session-001",
			status: "issued",
		}),
	});

	for (const [key, value, reason] of [
		["ownerUserId", "user-002", "owner-mismatch"],
		["patientId", "patient-002", "patient-scope-mismatch"],
		["audience", "smart-customer", "audience-mismatch"],
		["resourceKey", "other-resource", "resource-mismatch"],
	] as const) {
		const result = evaluateExternalEntrySession(
			{ ...validSession(), [key]: value },
			context({ [key]: value }),
		);
		// 先分别改变会话和上下文，确保业务拒绝原因来自明确的匹配维度；
		// 这里再用原上下文确认不会因“双方一起变更”而错误放行。
		const mismatch = evaluateExternalEntrySession(
			{ ...validSession(), [key]: value },
			context(),
		);
		expect(result.allowed).toBe(true);
		expect(mismatch).toEqual({ allowed: false, reason });
	}
});

test("外部会话在到期时拒绝，并且 issuedAt 到 expiresAt 不能超过平台上限", () => {
	const expired = evaluateExternalEntrySession(
		{ ...validSession(), expiresAt: "2026-08-26T00:01:00.000Z" },
		context(),
	);
	expect(expired).toEqual({ allowed: false, reason: "expired" });

	const tooLong = {
		...validSession(),
		expiresAt: "2026-08-26T00:11:00.001Z",
	};
	expect(() => normalizeExternalEntrySession(tooLong)).toThrow(
		ExternalEntrySessionValidationError,
	);

	const beforeIssued = evaluateExternalEntrySession(
		validSession(),
		context({ now: new Date("2026-08-25T23:59:59.999Z") }),
	);
	expect(beforeIssued).toEqual({ allowed: false, reason: "not-yet-valid" });
});

test("外部会话只能成功消费一次，消费结果不修改输入对象", () => {
	const source = validSession();
	const consumed = consumeExternalEntrySession(source, context());

	expect(consumed.status).toBe("consumed");
	expect(consumed.consumedAt).toBe(now.toISOString());
	expect(source.status).toBe("issued");
	expect(() => consumeExternalEntrySession(consumed, context())).toThrow(
		ExternalEntrySessionConsumeError,
	);
});

test("撤回会话后不能消费，已消费会话不能被撤回伪装成可恢复", () => {
	const revoked = revokeExternalEntrySession(validSession(), now);
	expect(revoked.status).toBe("revoked");
	expect(evaluateExternalEntrySession(revoked, context())).toEqual({
		allowed: false,
		reason: "revoked",
	});

	const consumed = consumeExternalEntrySession(validSession(), context());
	expect(() => revokeExternalEntrySession(consumed, now)).toThrow(
		ExternalEntrySessionConsumeError,
	);
});

test("会话终态时间必须落在签发后的合法时间线上", () => {
	expect(() =>
		normalizeExternalEntrySession({
			...validSession(),
			status: "consumed",
			consumedAt: "2026-08-25T23:59:59.000Z",
		}),
	).toThrow(ExternalEntrySessionValidationError);

	expect(() =>
		normalizeExternalEntrySession({
			...validSession(),
			status: "consumed",
			consumedAt: "2026-08-26T00:06:00.000Z",
		}),
	).toThrow(ExternalEntrySessionValidationError);

	expect(() =>
		revokeExternalEntrySession(
			validSession(),
			new Date("2026-08-25T23:59:59.000Z"),
		),
	).toThrow(ExternalEntrySessionValidationError);
});

test("消费和撤回拒绝 Invalid Date，不把 NaN 当成有效时间", () => {
	expect(() =>
		evaluateExternalEntrySession(
			validSession(),
			context({ now: new Date(Number.NaN) }),
		),
	).toThrow(ExternalEntrySessionValidationError);
	expect(() =>
		revokeExternalEntrySession(validSession(), new Date(Number.NaN)),
	).toThrow(ExternalEntrySessionValidationError);
});

test("会话材料拒绝未知字段、不带时区的时间和不完整终态", () => {
	expect(() =>
		normalizeExternalEntrySession({
			...validSession(),
			accessToken: "must-not-cross-boundary",
		}),
	).toThrow(ExternalEntrySessionValidationError);

	expect(() =>
		normalizeExternalEntrySession({
			...validSession(),
			issuedAt: "2026-08-26T00:00:00.000",
		}),
	).toThrow(ExternalEntrySessionValidationError);

	expect(() =>
		normalizeExternalEntrySession({
			...validSession(),
			status: "consumed",
		}),
	).toThrow(ExternalEntrySessionValidationError);
});
