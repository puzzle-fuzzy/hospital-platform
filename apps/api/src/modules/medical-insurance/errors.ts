/** 医保统一支付核心的输入错误；HTTP 层将其映射为稳定的 4xx 合同。 */
export class MedicalInsuranceRegistrationInputError extends Error {
	constructor(message = "Medical insurance registration input is invalid") {
		super(message);
		this.name = "MedicalInsuranceRegistrationInputError";
	}
}

/** 订单不存在或不属于当前会话时使用同一个错误，避免泄露跨 owner 数据。 */
export class MedicalInsuranceOrderNotFoundError extends Error {
	constructor() {
		super("Medical insurance order was not found");
		this.name = "MedicalInsuranceOrderNotFoundError";
	}
}
