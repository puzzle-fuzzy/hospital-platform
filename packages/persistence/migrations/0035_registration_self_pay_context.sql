-- 普通挂号自费在微信 APIv3 下单前生成的众阳 .1/.32/.2 关联上下文。
-- 只保存 AES-GCM 密文，患者证件及 Provider 流水不得以明文列落库。
ALTER TABLE hp_payment_orders
	ADD COLUMN registration_self_pay_context_ciphertext TEXT NULL AFTER updated_at;
