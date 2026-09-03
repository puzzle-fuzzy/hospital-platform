/**
 * 医保 6201 凭证上下文。
 *
 * payToken 只能在服务端 provider 调用的窄边界内出现。公共 handle 和订单
 * 读模型都不含原文；持久化实现必须只保存加密载荷，并在过期/撤销后拒绝读取。
 */
export type MedicalInsuranceCredentialPurpose = "settlement" | "query";

/**
 * 6301/6401 必需的 provider 实名查询上下文。
 *
 * 这些字段和 payToken 一样只能在 provider adapter 的窄边界内出现，公共
 * handle、订单读模型、日志和 outbox 都不能携带它们。
 */
export type MedicalInsuranceProviderQueryIdentity = {
	orgCodg: string;
	idNo: string;
	userName: string;
	idType: string;
};

export function isValidMedicalInsuranceProviderQueryIdentity(
	value: unknown,
): value is MedicalInsuranceProviderQueryIdentity {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const input = value as Record<string, unknown>;
	return ["orgCodg", "idNo", "userName", "idType"].every((field) => {
		const candidate = input[field];
		return (
			typeof candidate === "string" &&
			candidate.length > 0 &&
			candidate.length <= 128 &&
			candidate === candidate.trim() &&
			!Array.from(candidate).some((character) => {
				const code = character.charCodeAt(0);
				return code <= 0x1f || code === 0x7f;
			})
		);
	});
}

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
		providerQueryIdentity: MedicalInsuranceProviderQueryIdentity;
	};

export type MedicalInsuranceCredentialRepository = {
	put(input: {
		credentialId: string;
		ownerUserId: string;
		medicalOrderId: string;
		payOrdId: string;
		payToken: string;
		providerQueryIdentity: MedicalInsuranceProviderQueryIdentity;
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
	getActiveForOrder(input: {
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
