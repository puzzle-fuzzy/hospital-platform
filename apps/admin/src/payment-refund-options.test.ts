import { expect, test } from "bun:test";
import { registrationRefundFeedback } from "./payment-refund-options";
import type { AdminPaymentRefundResult } from "./types";

const result: AdminPaymentRefundResult = {
	source: "payment_order",
	orderId: "synthetic-registration-order",
	refundType: "ALL",
	status: "processing",
	amounts: { totalFen: 1000, cashFen: 1000, personalAccountFen: 0, fundFen: 0 },
};

test("已全退且退号成功但医院回写待处理时，明确区分退号结果和收费记录", () => {
	expect(
		registrationRefundFeedback({
			...result,
			registrationRefundStage: "appointment_cancelled_writeback_pending",
			registrationCancellationPending: false,
			registrationCancellationConfirmed: true,
			hospitalWritebackPending: true,
		}),
	).toEqual({
		title: "微信已退款、挂号已取消",
		description:
			"医院退费回写仍待核对，请联系医院确认收费记录；请勿再次发起退款。",
		type: "warning",
	});
});

test("退号待确认且医院回写也未完成时，不误报医院已回写", () => {
	const feedback = registrationRefundFeedback({
		...result,
		registrationRefundStage: "appointment_cancellation_pending",
		registrationCancellationPending: true,
		registrationCancellationConfirmed: false,
		hospitalWritebackPending: true,
	});
	expect(feedback?.title).toBe("微信已退款，挂号取消待确认");
	expect(feedback?.description).toContain(
		"微信已退款，挂号取消待确认；医院退费回写仍待处理",
	);
	expect(feedback?.description).toContain("请勿再次发起退款");
	expect(`${feedback?.title}${feedback?.description}`).not.toContain(
		"医院已回写",
	);
	expect(feedback?.type).toBe("warning");
});

test("旧无新增布尔字段的退号待确认响应保留原兼容说明", () => {
	expect(
		registrationRefundFeedback({
			...result,
			registrationRefundStage: "appointment_cancellation_pending",
		}),
	).toEqual({
		title: "微信已退款、医院已回写，等待取消挂号",
		description: "医院退费回写已确认，挂号尚未取消，请查询最新状态。",
		type: "warning",
	});
});

test("旧医院回写待处理阶段提供人工核对提示，不承诺自动补偿或重复退款", () => {
	const feedback = registrationRefundFeedback({
		...result,
		registrationRefundStage: "hospital_writeback_pending",
	});
	expect(feedback?.description).toContain("请联系医院核对收费记录和挂号状态");
	expect(feedback?.description).toContain("请勿再次发起退款");
	expect(feedback?.description).not.toMatch(/自动|将会|系统会/u);
	expect(feedback?.type).toBe("warning");
});

test.each([
	{ hospitalWritebackPending: true },
	{ registrationCancellationPending: true },
	{ registrationCancellationConfirmed: false },
])("显式未完成证据不能被旧completed阶段误报为全部完成：%j", (pending) => {
	const feedback = registrationRefundFeedback({
		...result,
		...pending,
		status: "succeeded",
		registrationRefundStage: "completed",
	});
	expect(feedback?.title).toBe("退款并取消挂号结果待核对");
	expect(feedback?.type).toBe("warning");
});

test("旧成功响应兼容完成提示，新待回写阶段始终不显示全部完成", () => {
	expect(
		registrationRefundFeedback({
			...result,
			status: "succeeded",
			registrationRefundStage: "completed",
		})?.type,
	).toBe("success");
	expect(
		registrationRefundFeedback({
			...result,
			status: "succeeded",
			registrationRefundStage: "appointment_cancelled_writeback_pending",
		})?.type,
	).toBe("warning");
	expect(
		registrationRefundFeedback({
			...result,
			source: "medical_insurance",
			registrationRefundStage: "appointment_cancelled_writeback_pending",
		}),
	).toBeUndefined();
});
