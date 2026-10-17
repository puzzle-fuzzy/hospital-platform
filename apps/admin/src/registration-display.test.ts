import { describe, expect, test } from "bun:test";
import {
	canCancelRegistration,
	cancellationAttemptStorageKey,
	readCancellationAttempt,
	registrationStatusLabel,
	validCancellationReason,
} from "./registration-display";
import type { AdminRegistrationStatus } from "./types";

const checked: AdminRegistrationStatus = {
	appointmentId: "appointment-1",
	localStatus: "booked",
	hospitalStatus: "scheduled",
	hospitalPaymentStatus: "pending",
	checkedAt: "2026-10-17T06:00:00.000Z",
	cancellation: {
		allowed: true,
		mode: "cancel_only",
		reason: "未支付，可取消",
	},
};

describe("registration status and cancellation UI gates", () => {
	test("shows local snapshots distinctly from hospital confirmation", () => {
		expect(
			registrationStatusLabel({
				...checked,
				hospitalStatus: "not_checked",
				checkedAt: null,
			}),
		).toBe("平台已预约 / 医院未核对");
		expect(registrationStatusLabel()).toBe("待核对");
		expect(
			registrationStatusLabel({ ...checked, hospitalStatus: "completed" }),
		).toBe("已完成");
		expect(
			registrationStatusLabel({ ...checked, hospitalStatus: "registered" }),
		).toBe("已登记");
	});
	test("requires a checked, scheduled and server-authorized registration", () => {
		expect(canCancelRegistration(checked)).toBe(true);
		for (const value of [
			undefined,
			{ ...checked, checkedAt: null },
			{ ...checked, appointmentId: null },
			{ ...checked, localStatus: "cancelled" as const },
			{ ...checked, hospitalStatus: "unknown" as const },
			{ ...checked, hospitalStatus: "completed" as const },
			{ ...checked, hospitalStatus: "registered" as const },
			{ ...checked, cancellation: { ...checked.cancellation, allowed: false } },
			{
				...checked,
				cancellation: { ...checked.cancellation, mode: "unavailable" as const },
			},
		])
			expect(canCancelRegistration(value)).toBe(false);
	});
	test("allows hospital paid marker only when server explicitly verifies refund and writeback evidence", () => {
		expect(
			canCancelRegistration({
				...checked,
				hospitalPaymentStatus: "paid",
				cancellation: {
					allowed: true,
					mode: "cancel_only",
					reason: "退款及回写已确认，仅补取消",
				},
			}),
		).toBe(true);
		expect(
			canCancelRegistration({
				...checked,
				hospitalPaymentStatus: "paid",
				cancellation: {
					allowed: false,
					mode: "unavailable",
					reason: "请先退费",
				},
			}),
		).toBe(false);
	});
	test("requires a useful bounded reason with no control characters", () => {
		for (const reason of ["", " ", "短", "长".repeat(81), "申请\n取消"])
			expect(validCancellationReason(reason)).toBe(false);
		expect(validCancellationReason("  患者申请取消  ")).toBe(true);
	});
	test("restores original command and reason but always requires a fresh query after reopening", () => {
		const saved = {
			idempotencyKey: "admin-cancel:stable",
			reason: "患者申请取消",
			needsQuery: false,
		};
		const restored = readCancellationAttempt(
			{ getItem: () => JSON.stringify(saved) },
			"key",
		);
		expect(restored).toEqual({ ...saved, needsQuery: true });
		expect(
			cancellationAttemptStorageKey({
				source: "payment_order",
				orderId: "order-1",
			}),
		).not.toBe(
			cancellationAttemptStorageKey({
				source: "medical_insurance",
				orderId: "order-1",
			}),
		);
	});
	test("does not accept corrupt persisted cancellation identities", () => {
		for (const value of [
			"not-json",
			"null",
			JSON.stringify({
				idempotencyKey: "bad/key",
				reason: "申请取消",
				needsQuery: true,
			}),
			JSON.stringify({
				idempotencyKey: "valid",
				reason: "短",
				needsQuery: true,
			}),
		])
			expect(
				readCancellationAttempt({ getItem: () => value }, "key"),
			).toBeUndefined();
	});
});
