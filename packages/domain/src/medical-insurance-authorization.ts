/**
 * 医保授权后的短期服务端上下文。
 *
 * payAuthNo、ecToken、参保号和微信 subject 只能由服务端 adapter 使用，
 * 不进入 API 响应、订单读模型、日志或 outbox。持久化实现必须加密 payload，
 * 并按 owner、订单和过期时间绑定读取。
 */
export type MedicalInsuranceAuthorizationContext = {
	authorizationId: string;
	ownerUserId: string;
	medicalOrderId: string;
	providerSubject: string;
	payAuthNo: string;
	patient: {
		idNo: string;
		userName: string;
		idType: string;
	};
	psnNo: string;
	insutype: string;
	insuplcAdmdvs: string;
	insuCode: string;
	/** 1101 参保快照中供 2.27.2.32 networkRegister 使用的可选字段。 */
	companyName?: string;
	netPatType?: string;
	/** 1101.baseinfo.exp_content.business_token；缺失时 6201 使用 payAuthNo。 */
	ecToken?: string;
	regionCode?: string;
	expiresAt: string;
	createdAt: string;
};

export type MedicalInsuranceAuthorizationRepository = {
	put(
		input: MedicalInsuranceAuthorizationContext,
	): Promise<
		Pick<
			MedicalInsuranceAuthorizationContext,
			| "authorizationId"
			| "ownerUserId"
			| "medicalOrderId"
			| "expiresAt"
			| "createdAt"
		>
	>;
	get(input: {
		authorizationId: string;
		ownerUserId: string;
		medicalOrderId: string;
		now: string;
	}): Promise<MedicalInsuranceAuthorizationContext | undefined>;
	getActiveForOrder(input: {
		ownerUserId: string;
		medicalOrderId: string;
		now: string;
	}): Promise<MedicalInsuranceAuthorizationContext | undefined>;
};
