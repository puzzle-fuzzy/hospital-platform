-- V2.2.5 6202 结算金额扩展。历史订单按 0 兼容，新的 6202 结果不再丢失扩展金额。
ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN other_payment_fen BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '6202 othFeeAmt' AFTER fund_fen,
	ADD COLUMN hospital_part_fen BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '6202 hospPartAmt' AFTER other_payment_fen,
	ADD COLUMN personal_account_mutual_aid_fen BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '6202 acctMulaidPay' AFTER hospital_part_fen,
	ADD COLUMN personal_account_self_fen BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '6202 selfAcctPay' AFTER personal_account_mutual_aid_fen,
	ADD COLUMN deposit_fen BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '6202 deposit' AFTER personal_account_self_fen,
	ADD COLUMN delivery_fee_fen BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '6202 delvFee' AFTER deposit_fen;
