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

/** 医院当前只开通高平参保人的医保支付；不包含任何患者或授权资料。 */
export class MedicalInsuranceRegionUnsupportedError extends Error {
	constructor() {
		super("当前参保地暂未开通医保支付，请选择微信支付");
		this.name = "MedicalInsuranceRegionUnsupportedError";
	}
}
