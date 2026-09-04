/**
 * 医保移动支付的业务类型。
 *
 * 挂号和门诊在产品入口上必须保持分开，但在医保订单、微信支付和
 * 查单/对账层属于同一类“医疗支付订单”。这个枚举是两者之间的明确
 * 分界：上层入口选择业务类型，底层 adapter 根据订单事实填写协议字段。
 */
export type MedicalInsuranceBusinessType = "registration" | "outpatient";

/**
 * 微信医保统一下单的业务类型字段。
 *
 * 依据本地同步的《对接移动医疗平台接口文档_国家局v4.0》“3.3 统一
 * 下单接口”截图和读取记录：RegPay 表示挂号支付，DiagPay 表示诊间
 * 支付。新版微信 v3 请求仍需要由服务端把正确业务类型写入订单请求，
 * 不能由部署环境用一个全局值覆盖所有业务。
 */
export type MedicalInsuranceOrderType = "RegPay" | "DiagPay";

export const MEDICAL_INSURANCE_ORDER_TYPES: readonly MedicalInsuranceOrderType[] =
	["RegPay", "DiagPay"];

/** 业务入口与医保统一下单字段的一一映射；未知业务不允许猜测。 */
export function medicalInsuranceOrderTypeForBusiness(
	businessType: MedicalInsuranceBusinessType,
): MedicalInsuranceOrderType {
	return businessType === "registration" ? "RegPay" : "DiagPay";
}

export function isMedicalInsuranceBusinessType(
	value: unknown,
): value is MedicalInsuranceBusinessType {
	return value === "registration" || value === "outpatient";
}

export function isMedicalInsuranceOrderType(
	value: unknown,
): value is MedicalInsuranceOrderType {
	return value === "RegPay" || value === "DiagPay";
}
