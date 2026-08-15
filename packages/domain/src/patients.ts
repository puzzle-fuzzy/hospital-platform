import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 关系值是内部规范化值，不能直接把旧系统的中文显示值写入领域层。 */
export type PatientRelationship =
	| "self"
	| "spouse"
	| "child"
	| "parent"
	| "other";

/** 患者端允许返回的最小档案视图；身份证号和完整卡号不进入这个模型。 */
export type PatientRecord = {
	id: string;
	ownerUserId: string;
	displayName: string;
	relationship: PatientRelationship;
	cardNumberMasked: string;
	source: "hospital-his" | "legacy-record";
};

/** 与微信 provider 的 subject 解耦的内部用户身份；业务表只引用 userId。 */
export type IdentityUser = {
	userId: string;
	providerSubject: string;
	unionId?: string;
};

/** 身份仓储负责把 provider 身份幂等映射为平台用户。 */
export interface UserIdentityRepository {
	findOrCreateByWechat(input: {
		providerSubject: string;
		unionId?: string;
	}): Promise<IdentityUser>;
}

/** 患者仓储必须按 ownerUserId 过滤，禁止由客户端传入归属条件。 */
export interface PatientRepository {
	listByOwner(ownerUserId: string): Promise<readonly PatientRecord[]>;
}

/** 微信登录 provider 边界；code2session 的原始报文不离开 adapter 层。 */
export interface WechatIdentityGateway {
	exchangeCode(
		input: { code: string },
		context: AdapterCallContext,
	): Promise<{
		providerSubject: string;
		unionId?: string;
		trace: ExternalTrace;
	}>;
}
