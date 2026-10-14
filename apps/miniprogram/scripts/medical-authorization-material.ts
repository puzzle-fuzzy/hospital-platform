export type MedicalAuthorizationMaterial = Readonly<{
	orgAppId: string;
	orgChannelCredential: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 正式授权的应用 ID 与认证码必须取自同一份正式材料集合。 */
export function resolveProductionMedicalAuthorizationMaterial(
	input: unknown,
): MedicalAuthorizationMaterial {
	// 未安装本机材料时沿用医保不可用的构建，不携带旧测试应用 ID。
	if (input === undefined) return { orgAppId: "", orgChannelCredential: "" };
	if (
		!isRecord(input) ||
		input.environment !== "production" ||
		!isRecord(input.paymentChannelFeedback) ||
		!isRecord(input.identityVerificationFeedback)
	) {
		throw new Error(
			"Mini program medical authorization requires production materials",
		);
	}
	const orgAppId = input.paymentChannelFeedback.appId;
	const orgChannelCredential =
		input.identityVerificationFeedback.orgChannelAuthCode;
	if (
		typeof orgAppId !== "string" ||
		!orgAppId.trim() ||
		typeof orgChannelCredential !== "string" ||
		!orgChannelCredential.trim()
	) {
		throw new Error(
			"Mini program medical authorization requires both production app ID and credential",
		);
	}
	return {
		orgAppId: orgAppId.trim(),
		orgChannelCredential: orgChannelCredential.trim(),
	};
}
