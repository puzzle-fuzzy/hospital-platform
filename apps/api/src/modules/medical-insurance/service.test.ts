import { describe, expect, test } from "bun:test";
import { createSmCryptoLegacyFsiCrypto } from "@hospital/adapters";
import type { MedicalInsuranceOrder } from "@hospital/domain";
import { createInMemoryMedicalInsuranceOrderRepository } from "@hospital/persistence";
import { MedicalInsuranceNotificationService } from "./service";

/**
 * 用测试密钥构造 crypto → seal 模拟 6302 平台回包 → 走完整验签解密 → 状态机。
 * 覆盖：全额医保 / 有自费差额 / 金额不一致 / 未知订单 / 篡改签名。
 */

const hexToB64 = (hex: string): string =>
	Buffer.from(hex, "hex").toString("base64");

const crypto = createSmCryptoLegacyFsiCrypto({
	appId: "43AF047BBA47FC8A1AE8EFB232BDBBCB",
	appSecret: "4117E877F5FA0A0188891283E4B617D5",
	channelPrivateKeyB64: hexToB64(
		"211fee8c3c5fee2fad3dc926fc9403366d2def02cdd0bb5bd683ca015d99db7f",
	),
	platformPublicKeyB64: hexToB64(
		"0417cc16abaebedc7f87b2e0a508c0cb93631761db7fa19adece712c6aade1d673e389b5e902df7a2e6fe3917b0f55747e00d74e36e939ecc3e7967b7058a91858",
	),
	sm2UserId: "1234567812345678",
});
const context = { traceId: "trace-mi-test", idempotencyKey: "idem-mi-test" };

function makeOrder(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "mi-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		idempotencyKey: "idem-001",
		medOrgOrd: "MED-001",
		chrgBchno: "BCH-001",
		payOrdId: "PO-001",
		payTokenHash: null,
		status: "order_placed",
		ordStas: "2",
		amounts: {
			totalFen: 100,
			cashFen: 0,
			personalAccountFen: 40,
			fundFen: 60,
		},
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: "2026-09-03T00:00:00.000Z",
		updatedAt: "2026-09-03T00:00:00.000Z",
		...overrides,
	};
}

async function makeService(order?: MedicalInsuranceOrder) {
	const repo = createInMemoryMedicalInsuranceOrderRepository();
	if (order) await repo.insert(order);
	return {
		service: new MedicalInsuranceNotificationService({ crypto, orders: repo }),
		repo,
	};
}

async function seal6302(data: Record<string, unknown>) {
	return crypto.seal({ infno: "6201", data }, context);
}

describe("医保 6302 结算通知", () => {
	test("全额医保（cash=0）推进到 insurance_settled", async () => {
		const { service, repo } = await makeService();
		await repo.insert(makeOrder());
		const sealed = await seal6302({
			payOrdId: "PO-001",
			callType: "02",
			medOrgOrd: "MED-001",
			traceTime: "2026-09-03 12:00:00",
			feeSumamt: "1.00",
			ownPayAmt: "0",
			psnAcctPay: "0.40",
			fundPay: "0.60",
			setlType: "ALL",
			revsToken: "REV-001",
		});
		const ack = await service.receive({ payload: sealed, context });
		expect(ack.success).toBeTrue();
		const updated = await repo.findByPayOrdId("PO-001");
		expect(updated?.status).toBe("insurance_settled");
		expect(updated?.version).toBe(2);
	});

	test("有自费差额推进到 cash_pending", async () => {
		const { service, repo } = await makeService();
		await repo.insert(
			makeOrder({
				amounts: {
					totalFen: 100,
					cashFen: 30,
					personalAccountFen: 20,
					fundFen: 50,
				},
			}),
		);
		const sealed = await seal6302({
			payOrdId: "PO-001",
			callType: "02",
			medOrgOrd: "MED-001",
			traceTime: "t",
			feeSumamt: "1.00",
			ownPayAmt: "0.30",
			psnAcctPay: "0.20",
			fundPay: "0.50",
			setlType: "ALL",
			revsToken: "REV",
		});
		const ack = await service.receive({ payload: sealed, context });
		expect(ack.success).toBeTrue();
		expect((await repo.findByPayOrdId("PO-001"))?.status).toBe("cash_pending");
	});

	test("金额与订单不一致时进入 awaiting_confirmation 而非覆盖", async () => {
		const { service, repo } = await makeService();
		await repo.insert(makeOrder());
		const sealed = await seal6302({
			payOrdId: "PO-001",
			callType: "02",
			medOrgOrd: "MED-001",
			traceTime: "t",
			feeSumamt: "9.99",
			ownPayAmt: "0",
			psnAcctPay: "4.00",
			fundPay: "5.99",
			setlType: "ALL",
			revsToken: "REV",
		});
		await service.receive({ payload: sealed, context });
		expect((await repo.findByPayOrdId("PO-001"))?.status).toBe(
			"awaiting_confirmation",
		);
	});

	test("未知订单返回 success=false 而不抛错", async () => {
		const { service } = await makeService();
		const sealed = await seal6302({
			payOrdId: "PO-UNKNOWN",
			callType: "02",
			medOrgOrd: "MED-X",
			traceTime: "t",
			feeSumamt: "1.00",
			ownPayAmt: "0",
			psnAcctPay: "1.00",
			fundPay: "0",
			setlType: "HI",
			revsToken: "R",
		});
		const ack = await service.receive({ payload: sealed, context });
		expect(ack.success).toBeFalse();
	});

	test("篡改签名导致验签失败并抛错（fail-closed）", async () => {
		const { service, repo } = await makeService();
		await repo.insert(makeOrder());
		const sealed = await seal6302({
			payOrdId: "PO-001",
			callType: "02",
			medOrgOrd: "MED-001",
			traceTime: "t",
			feeSumamt: "1.00",
			ownPayAmt: "0",
			psnAcctPay: "0.40",
			fundPay: "0.60",
			setlType: "ALL",
			revsToken: "R",
		});
		const tampered = { ...sealed, signData: `XX${sealed.signData.slice(2)}` };
		await expect(
			service.receive({ payload: tampered, context }),
		).rejects.toThrow();
		expect((await repo.findByPayOrdId("PO-001"))?.status).toBe("order_placed");
	});
});
