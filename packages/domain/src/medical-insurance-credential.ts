/**
 * 医保 6201 凭证上下文。
 *
 * payToken 只能在服务端 provider 调用的窄边界内出现。公共 handle 和订单
 * 读模型都不含原文；持久化实现必须只保存加密载荷，并在过期/撤销后拒绝读取。
 */
export type MedicalInsuranceCredentialPurpose = "settlement" | "query";

export type MedicalInsuranceCredentialHandle = {
	credentialId: string;
	ownerUserId: string;
	medicalOrderId: string;
	payOrdId: string;
	purpose: MedicalInsuranceCredentialPurpose;
	expiresAt: string;
	createdAt: string;
};

/** 仅供 provider adapter/gateway 内部使用，不得作为 API、日志或 outbox payload。 */
export type MedicalInsuranceCredentialContext =
	MedicalInsuranceCredentialHandle & {
		payToken: string;
	};

export type MedicalInsuranceCredentialRepository = {
	put(input: {
		credentialId: string;
		ownerUserId: string;
		medicalOrderId: string;
		payOrdId: string;
		payToken: string;
		purpose: MedicalInsuranceCredentialPurpose;
		expiresAt: string;
		createdAt: string;
	}): Promise<MedicalInsuranceCredentialHandle>;
	get(input: {
		credentialId: string;
		ownerUserId: string;
		medicalOrderId: string;
		purpose: MedicalInsuranceCredentialPurpose;
		now: string;
	}): Promise<MedicalInsuranceCredentialContext | undefined>;
	revoke(input: {
		credentialId: string;
		ownerUserId: string;
		medicalOrderId: string;
		now: string;
	}): Promise<boolean>;
};
