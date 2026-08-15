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

/**
 * 外部患者目录经过 adapter 白名单映射后的最小事实。
 *
 * provider 患者号只用于后续同步映射，不是平台公开患者 id；身份证号、手机号、
 * 完整卡号和 provider 原始字段都不允许进入这个类型。
 */
export type PatientDirectoryProfile = {
	providerPatientId: string;
	displayName: string;
	relationship: PatientRelationship;
	cardNumberMasked: string;
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
	/** 仅供服务端向 provider 发起受控操作；provider subject 不得进入 API 响应或日志。 */
	findByUserId(userId: string): Promise<IdentityUser | undefined>;
}

/** 患者仓储必须按 ownerUserId 过滤，禁止由客户端传入归属条件。 */
export interface PatientRepository {
	listByOwner(ownerUserId: string): Promise<readonly PatientRecord[]>;
}

/** 众阳/HIS 患者目录只通过服务端身份查询，禁止小程序直接携带 unionId。 */
export interface PatientDirectoryGateway {
	listByIdentity(
		input: { unionId: string },
		context: AdapterCallContext,
	): Promise<{
		patients: readonly PatientDirectoryProfile[];
		trace: ExternalTrace;
	}>;
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
