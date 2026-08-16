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
 * 一次完整患者目录同步的输入。
 *
 * `observedAt` 是本次 provider 快照的统一时间点。持久化层必须在同一个
 * 事务中先 upsert 本次出现的患者，再把同一 owner/provider 下更早且未出现
 * 的患者标记为 inactive；不能逐条写入后再异步清理，否则中途失败会把
 * “本次目录不完整”误写成“患者已经失效”。
 */
export type PatientDirectorySnapshotInput = {
	ownerUserId: string;
	provider: "zhongyang";
	observedAt: string;
	/**
	 * 非空时表示本次快照属于一个已取得租约的同步操作。
	 * 持久化实现必须把快照提交和 operation 标记为 succeeded 放在同一事务内。
	 */
	operationId?: string;
	/** 租约代次；防止旧请求在 lease takeover 后完成新一轮 operation。 */
	operationAttemptCount?: number;
	/**
	 * `complete=true` 时，profile.providerReferences 的存在与缺失都是本次
	 * 快照事实：缺少临床引用就必须清理旧的 `his-patient` 映射，不能把上次
	 * 同步的 patId 当成当前有效身份继续使用。
	 */
	patients: ReadonlyArray<
		Pick<PatientDirectoryUpsertInput, "patientId" | "profile">
	>;
};

/** 患者目录同步只允许这两个持久化状态，失败通过租约到期恢复，不缓存永久失败。 */
export type PatientDirectorySyncOperationStatus = "in_progress" | "succeeded";

/** 开始同步时仓储返回的并发分支。 */
export type PatientDirectorySyncStart =
	| {
			outcome: "started";
			operationId: string;
			attemptCount: number;
	  }
	| {
			outcome: "replay";
			operationId: string;
			attemptCount: number;
	  }
	| {
			outcome: "in_progress";
			operationId: string;
			attemptCount: number;
			leaseUntil: string;
	  };

/** 开始一次同步所需的 owner-scoped 幂等上下文。 */
export type PatientDirectorySyncStartInput = {
	ownerUserId: string;
	provider: "zhongyang";
	idempotencyKey: string;
	now: string;
	leaseUntil: string;
};

/** 患者目录快照的持久化结果；失效数量只用于安全日志，不进入小程序响应。 */
export type PatientDirectorySnapshotResult = {
	activePatients: readonly PatientRecord[];
	deactivatedPatientCount: number;
};

/**
 * MySQL 中的同步操作记录；key 原文只在仓储边界使用，禁止进入日志和 API 响应。
 */
export type PatientDirectorySyncOperation = {
	operationId: string;
	ownerUserId: string;
	provider: "zhongyang";
	idempotencyKey: string;
	status: PatientDirectorySyncOperationStatus;
	attemptCount: number;
	observedAt?: string;
	leaseUntil: string;
	completedAt?: string;
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
	/**
	 * 为同步请求原子取得 owner/provider/key 租约。
	 * 生产仓储必须实现；缺少该能力时 PatientService 必须 fail-closed。
	 */
	beginDirectorySync?(
		input: PatientDirectorySyncStartInput,
	): Promise<PatientDirectorySyncStart>;
	upsertFromDirectory(
		input: PatientDirectoryUpsertInput,
	): Promise<PatientRecord>;
	/**
	 * 用完整 provider 目录替换当前 owner/provider 快照。
	 *
	 * 这是生产同步的必选能力；保留为可选是为了让只读业务测试仓储不被迫
	 * 实现目录写入。PatientService 在同步时会 fail-closed 检查该能力。
	 */
	replaceDirectorySnapshot?(
		input: PatientDirectorySnapshotInput,
	): Promise<PatientDirectorySnapshotResult>;
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
		/** 只有 provider 响应确定是完整目录时才允许执行失效回收。 */
		complete: true;
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
