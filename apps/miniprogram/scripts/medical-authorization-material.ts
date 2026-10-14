export type MedicalAuthorizationMaterial = Readonly<{
	orgAppId: string;
	orgChannelCredential: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 授权的应用 ID 与认证码必须取自调用方指定环境的同一份材料集合。 */
function resolveMedicalAuthorizationMaterial(
	input: unknown,
	expectedEnvironment: "production" | "test",
): MedicalAuthorizationMaterial {
	// 未安装本机材料时同时关闭两个字段，不能沿用另一环境的配置。
	if (input === undefined) return { orgAppId: "", orgChannelCredential: "" };
	if (
		!isRecord(input) ||
		input.environment !== expectedEnvironment ||
		!isRecord(input.paymentChannelFeedback) ||
		!isRecord(input.identityVerificationFeedback)
	) {
		throw new Error(
			"Mini program medical authorization materials must match the selected environment",
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
			"Mini program medical authorization requires both app ID and credential",
		);
	}
	return {
		orgAppId: orgAppId.trim(),
		orgChannelCredential: orgChannelCredential.trim(),
	};
}

export function resolveProductionMedicalAuthorizationMaterial(
	input: unknown,
): MedicalAuthorizationMaterial {
	return resolveMedicalAuthorizationMaterial(input, "production");
}

export function resolveTestMedicalAuthorizationMaterial(
	input: unknown,
): MedicalAuthorizationMaterial {
	return resolveMedicalAuthorizationMaterial(input, "test");
}
