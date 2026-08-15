import { Type, type Static } from "@sinclair/typebox";

export const HealthResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		status: Type.Literal("ok"),
		service: Type.String(),
		version: Type.String(),
	}),
});

export const ReadyResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		status: Type.Literal("not_ready"),
		dependencies: Type.Object({
			database: Type.Literal("not_configured"),
			redis: Type.Literal("not_configured"),
		}),
	}),
});

export const PingResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		service: Type.String(),
		apiVersion: Type.String(),
	}),
});

export const PaymentStateSchema = Type.Union([
	Type.Literal("created"),
	Type.Literal("authorized"),
	Type.Literal("pre_settled"),
	Type.Literal("insurance_submitted"),
	Type.Literal("insurance_settled"),
	Type.Literal("cash_pending"),
	Type.Literal("cash_paid"),
	Type.Literal("his_written_back"),
	Type.Literal("awaiting_confirmation"),
	Type.Literal("completed"),
	Type.Literal("failed"),
	Type.Literal("cancelled"),
]);

export type PaymentState = Static<typeof PaymentStateSchema>;

export type HealthPayload = Static<typeof HealthResponse>;
export type ReadyPayload = Static<typeof ReadyResponse>;
export type PingPayload = Static<typeof PingResponse>;

export function success<const T>(data: T): { success: true; data: T } {
	return { success: true, data };
}
