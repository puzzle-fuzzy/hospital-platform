-- 6202 的个账使用标志由服务端根据 2.6.33 与 1101 事实推导并冻结。
-- 不能在 6202 重试时重新使用前端输入或旧页面缓存。
ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN acct_used_flag VARCHAR(1) NULL AFTER mdtrt_id;
