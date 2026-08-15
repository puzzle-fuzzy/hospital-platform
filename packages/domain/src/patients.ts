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
	/**
	 * 同一患者在不同 provider 能力中的外部引用。
	 *
	 * `thirdPatientId` 只适合患者目录接口；预约、报告和门诊费用接口
	 * 使用的是档案接口返回的 HIS `patId`。两者必须分开持久化，禁止
	 * 用一个字段“碰巧兼容”多个上游接口。
	 */
	providerReferences?: Partial<Record<PatientProviderReferenceKind, string>>;
};

/** 众阳目录 ID 与临床档案 patId 的用途边界。 */
export type PatientProviderReferenceKind = "directory" | "his-patient";

/** 患者目录同步写入所需的内部 id；provider id 永远只停留在持久化映射边界。 */
export type PatientDirectoryUpsertInput = {
	ownerUserId: string;
	patientId: string;
	provider: "zhongyang";
	profile: PatientDirectoryProfile;
};

/**
 * 服务端下游 provider adapter 使用的内部引用。
 *
 * 该类型故意不包含在 PatientRecord 中，避免 provider 患者号被 API read
 * model、日志或小程序响应意外暴露；只有已完成 owner 校验的服务端流程才能取得它。
 */
export type PatientProviderReference = {
	patientId: string;
	provider: "zhongyang";
	providerPatientId: string;
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
	upsertFromDirectory(
		input: PatientDirectoryUpsertInput,
	): Promise<PatientRecord>;
	/** 按 owner 隔离解析 provider 引用；provider 患者号不得进入公共响应。 */
	resolveProviderReference(input: {
		ownerUserId: string;
		patientId: string;
		provider: "zhongyang";
		/** 未指定时读取旧的目录引用；临床接口必须显式请求 his-patient。 */
		referenceKind?: PatientProviderReferenceKind;
	}): Promise<PatientProviderReference | undefined>;
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
