-- 医保授权及费用上传的服务端引用；authCode/payToken 原文不落库。
ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN fee_upload_id VARCHAR(128) NULL AFTER authorization_id;
