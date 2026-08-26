import { normalizeExternalTrace } from "./external-trace";
import { isBoundedOpaqueIdentifier } from "./opaque-identifier";
import type { AdapterCallContext, ExternalTrace } from "./ports";

/**
 * 关系值是内部规范化值，不能直接把旧系统的中文显示值写入领域层。
 *
 * `other` 只表示 Provider 明确声明了“其他”；`unknown` 表示上游没有提供
 * 关系，或提供了平台暂时无法识别的值。两者不能混用，否则页面会把“没有
 * 关系资料”误报成真实的家庭关系分类。
 */
export type PatientRelationship =
	| "self"
	| "spouse"
	| "child"
	| "parent"
	| "other"
	| "unknown";

/**
 * 当前患者是否具备临床只读业务所需的 HIS 档案映射。
 *
 * `unavailable` 不是患者不存在，而是只能展示旧目录资料，不能被预约历史、
 * 报告或门诊费用等需要 `his-patient` 引用的业务选中。把这个事实显式放在
 * 读模型中，避免小程序先“选中”再在下游 provider 请求前才失败。
 */
export type PatientClinicalAccess = "ready" | "unavailable";

/** 患者端允许返回的最小档案视图；身份证号和完整卡号不进入这个模型。 */
export type PatientRecord = {
	id: string;
	ownerUserId: string;
	displayName: string;
	relationship: PatientRelationship;
	cardNumberMasked: string;
	source: "hospital-his" | "legacy-record";
	clinicalAccess: PatientClinicalAccess;
};

/**
 * 患者读模型从仓储返回时的二次校验原因。
 *
 * MySQL repository 已经按 owner 和枚举做了第一层收窄，但 service 还会被
 * 内存仓储、回放任务和未来的读模型实现调用。TypeScript 的 PatientRecord
 * 不能约束运行时对象，因此 API 不能把仓储结果直接当成可信响应；尤其是
 * owner 错配、重复 patientId 和控制字符会分别造成越权、页面 key 混乱和
 * 日志/渲染边界污染。
 */
export type PatientReadModelViolation =
	| "patients-not-array"
	| "patients-too-many"
	| "patient-not-object"
	| "patient-id-invalid"
	| "patient-id-duplicate"
	| "patient-owner-mismatch"
	| "patient-display-name-invalid"
	| "patient-relationship-invalid"
	| "patient-card-number-invalid"
	| "patient-source-invalid"
	| "patient-clinical-access-invalid";

/** 仓储读模型不符合患者域安全边界时使用的固定错误。 */
export class PatientReadModelValidationError extends Error {
	readonly violation: PatientReadModelViolation;

	constructor(violation: PatientReadModelViolation) {
		super("Patient read model is invalid");
		this.name = "PatientReadModelValidationError";
		this.violation = violation;
	}
}

function invalidPatientReadModel(violation: PatientReadModelViolation): never {
	throw new PatientReadModelValidationError(violation);
}

/** 患者展示文本只允许稳定、有限且没有控制字符的字符串。 */
function hasSafePatientText(
	value: unknown,
	maxLength: number,
): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

/**
 * 患者卡号是“可核对但不可还原”的展示值，不是普通任意文本。
 *
 * Provider adapter 会保留最多前五位和后四位，中间必须存在连续掩码；
 * `未绑定` 是 adapter 对缺少卡号的固定哨兵值。这里在读模型边界再次
 * 校验形状，防止未来 MySQL 回放、手工修复或其它仓储把完整卡号带进
 * API，即使 TypeScript 的 `cardNumberMasked` 类型仍然写着 string。
 */
function isMaskedCardNumber(value: string): boolean {
	if (value === "未绑定") return true;
	return /^[A-Za-z0-9]{0,5}\*+[A-Za-z0-9]{0,4}$/u.test(value);
}

function isPatientRelationship(value: unknown): value is PatientRelationship {
	return (
		value === "self" ||
		value === "spouse" ||
		value === "child" ||
		value === "parent" ||
		value === "other" ||
		value === "unknown"
	);
}

function isPatientSource(value: unknown): value is PatientRecord["source"] {
	return value === "hospital-his" || value === "legacy-record";
}

function isPatientClinicalAccess(
	value: unknown,
): value is PatientClinicalAccess {
	return value === "ready" || value === "unavailable";
}

/**
 * 校验并重新投影 owner-scoped 患者读模型。
 *
 * 该函数只接受服务端仓储结果，不接受小程序提交的 owner；调用方必须把
 * 当前 Bearer principal 的 userId 作为 expectedOwnerUserId 传入。返回值会
 * 重新构造为 PatientRecord，任何未来仓储扩展字段（例如 provider 患者号）
 * 都不会沿着 service 误进入 API 或日志。
 */
export function normalizePatientReadModel(
	value: unknown,
	expectedOwnerUserId: string,
): PatientRecord[] {
	// expectedOwnerUserId 是服务端当前会话的授权根，不能只用它和仓储字段
	// 做字符串相等比较。API service 当前会先校验，但回放任务、Worker 或
	// 替换仓储可以直接进入 domain；异常 owner 若被原样接受，会让读模型把
	// 不可检索的归属带入页面、日志和后续 owner-scoped 查询。
	if (!isBoundedOpaqueIdentifier(expectedOwnerUserId)) {
		invalidPatientReadModel("patient-owner-mismatch");
	}
	if (!Array.isArray(value)) {
		invalidPatientReadModel("patients-not-array");
	}
	if (value.length > MAX_PATIENT_DIRECTORY_ITEMS) {
		// GET 读模型和同步快照返回值必须共享同一资源边界；不能让异常的
		// 仓储、回放器或人工修复绕过同步入口，把超大目录序列化到小程序。
		// 这里同样整批失败，不能截断后让用户把不完整目录当成全部患者。
		invalidPatientReadModel("patients-too-many");
	}
	const seenPatientIds = new Set<string>();
	return value.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidPatientReadModel("patient-not-object");
		}
		const record = item as Record<string, unknown>;
		const id = record.id;
		if (!isBoundedOpaqueIdentifier(id)) {
			invalidPatientReadModel("patient-id-invalid");
		}
		if (seenPatientIds.has(id)) {
			invalidPatientReadModel("patient-id-duplicate");
		}
		seenPatientIds.add(id);
		if (record.ownerUserId !== expectedOwnerUserId) {
			invalidPatientReadModel("patient-owner-mismatch");
		}
		if (!hasSafePatientText(record.displayName, 128)) {
			invalidPatientReadModel("patient-display-name-invalid");
		}
		if (!isPatientRelationship(record.relationship)) {
			invalidPatientReadModel("patient-relationship-invalid");
		}
		if (!hasSafePatientText(record.cardNumberMasked, 128)) {
			invalidPatientReadModel("patient-card-number-invalid");
		}
		if (!isMaskedCardNumber(record.cardNumberMasked)) {
			// 不能只做字符串长度校验：完整卡号同样可能是短文本，且会在
			// 进入 Elysia response schema 前已经泄露给调用层。读模型异常
			// 必须整批失败，不能只过滤一条后继续返回其它患者。
			invalidPatientReadModel("patient-card-number-invalid");
		}
		if (!isPatientSource(record.source)) {
			invalidPatientReadModel("patient-source-invalid");
		}
		if (!isPatientClinicalAccess(record.clinicalAccess)) {
			invalidPatientReadModel("patient-clinical-access-invalid");
		}
		return {
			id,
			ownerUserId: expectedOwnerUserId,
			displayName: record.displayName,
			relationship: record.relationship,
			cardNumberMasked: record.cardNumberMasked,
			source: record.source,
			clinicalAccess: record.clinicalAccess,
		};
	});
}

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

/**
 * 单次患者目录读模型和完整快照的资源上限。
 *
 * 这是平台资源防护，不是医院业务上的绑定人数上限，也不是 Provider 分页契约。
 * 超过上限必须整批拒绝，不能截断后触发快照失效回收，也不能把不完整读模型
 * 返回给小程序；待 Provider 正式分页契约到达后，再设计有界分页合并。
 */
export const MAX_PATIENT_DIRECTORY_ITEMS = 128;

/**
 * 患者目录 gateway 返回值违反同步写入 contract 时的固定原因。
 *
 * gateway 是可替换的端口，TypeScript 类型不能保护真实 HTTP、回放任务或
 * 未来组合根返回的运行时对象。同步在进入快照事务前必须拒绝整批异常，避免
 * 先把完整卡号、重复 provider 患者或未审计引用写入 MySQL，再等下次读取时才发现。
 */
export type PatientDirectoryResultViolation =
	| "result-not-object"
	| "snapshot-incomplete"
	| "patients-not-array"
	| "patients-too-many"
	| "patient-not-object"
	| "provider-patient-id-invalid"
	| "provider-patient-id-duplicate"
	| "patient-display-name-invalid"
	| "patient-relationship-invalid"
	| "patient-card-number-invalid"
	| "provider-references-invalid"
	| "provider-reference-duplicate"
	| "trace-invalid";

/** 患者目录同步不会把非法 gateway 结果交给持久化层。 */
export class PatientDirectoryResultValidationError extends Error {
	readonly violation: PatientDirectoryResultViolation;

	constructor(violation: PatientDirectoryResultViolation) {
		super("Patient directory provider result is invalid");
		this.name = "PatientDirectoryResultValidationError";
		this.violation = violation;
	}
}

function invalidPatientDirectoryResult(
	violation: PatientDirectoryResultViolation,
): never {
	throw new PatientDirectoryResultValidationError(violation);
}

function normalizePatientProviderReferences(
	value: unknown,
): Partial<Record<PatientProviderReferenceKind, string>> | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidPatientDirectoryResult("provider-references-invalid");
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.some((key) => key !== "directory" && key !== "his-patient")) {
		invalidPatientDirectoryResult("provider-references-invalid");
	}
	const normalized: Partial<Record<PatientProviderReferenceKind, string>> = {};
	for (const key of keys as PatientProviderReferenceKind[]) {
		if (!isBoundedOpaqueIdentifier(record[key])) {
			invalidPatientDirectoryResult("provider-references-invalid");
		}
		normalized[key] = record[key];
	}
	return keys.length > 0 ? normalized : undefined;
}

/**
 * 在患者目录快照事务前重新校验并投影 gateway 结果。
 *
 * 这不是对 adapter 的重复调用，而是写入边界的运行时保护：即使测试替身、
 * 回放器或未来 gateway 绕过了 adapter 的白名单，异常数据也只能停在 service
 * 层并记录固定 violation，不能污染快照或让下一次 GET 才发现数据损坏。
 */
export function normalizePatientDirectoryResult(value: unknown): {
	complete: true;
	patients: PatientDirectoryProfile[];
	trace: ExternalTrace;
} {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidPatientDirectoryResult("result-not-object");
	}
	const result = value as Record<string, unknown>;
	if (result.complete !== true) {
		invalidPatientDirectoryResult("snapshot-incomplete");
	}
	if (!Array.isArray(result.patients)) {
		invalidPatientDirectoryResult("patients-not-array");
	}
	if (result.patients.length > MAX_PATIENT_DIRECTORY_ITEMS) {
		// 不能 slice：完整快照被截断会把未返回的真实患者标记为 inactive。
		// 资源异常必须整批失败，并且要发生在字段映射、平台 ID 生成和快照事务之前。
		invalidPatientDirectoryResult("patients-too-many");
	}
	if (
		typeof result.trace !== "object" ||
		result.trace === null ||
		Array.isArray(result.trace)
	) {
		invalidPatientDirectoryResult("trace-invalid");
	}
	let trace: ExternalTrace;
	try {
		// 患者同步可能先读目录，再并发读取多条临床档案；如果 gateway 已经
		// 返回有界 requestIds，这里必须保留完整关联链，不能只留下主请求号。
		// 统一复用外部 trace 的运行时门禁，避免可替换 gateway 绕过列表长度、
		// 主 ID 归属或 Provider 归属校验。
		const normalizedTrace = normalizeExternalTrace(result.trace, {
			expectedProvider: "zhongyang",
		});
		if (normalizedTrace.operation !== "patient-list") {
			invalidPatientDirectoryResult("trace-invalid");
		}
		// 患者目录不产生 provider order；未知扩展字段不能进入领域结果，
		// 但已校验的 requestIds 是排障所需的低敏关联事实，应明确保留。
		trace = {
			provider: normalizedTrace.provider,
			operation: normalizedTrace.operation,
			requestId: normalizedTrace.requestId,
			...(normalizedTrace.requestIds
				? { requestIds: normalizedTrace.requestIds }
				: {}),
		};
	} catch {
		invalidPatientDirectoryResult("trace-invalid");
	}
	const seenProviderPatientIds = new Set<string>();
	const seenHisPatientIds = new Set<string>();
	const patients = result.patients.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidPatientDirectoryResult("patient-not-object");
		}
		const record = item as Record<string, unknown>;
		if (!isBoundedOpaqueIdentifier(record.providerPatientId)) {
			invalidPatientDirectoryResult("provider-patient-id-invalid");
		}
		if (seenProviderPatientIds.has(record.providerPatientId)) {
			invalidPatientDirectoryResult("provider-patient-id-duplicate");
		}
		seenProviderPatientIds.add(record.providerPatientId);
		if (!hasSafePatientText(record.displayName, 128)) {
			invalidPatientDirectoryResult("patient-display-name-invalid");
		}
		if (!isPatientRelationship(record.relationship)) {
			invalidPatientDirectoryResult("patient-relationship-invalid");
		}
		if (
			!hasSafePatientText(record.cardNumberMasked, 128) ||
			!isMaskedCardNumber(record.cardNumberMasked)
		) {
			invalidPatientDirectoryResult("patient-card-number-invalid");
		}
		const providerReferences = normalizePatientProviderReferences(
			record.providerReferences,
		);
		const hisPatientId = providerReferences?.["his-patient"];
		if (hisPatientId !== undefined) {
			// 目录 adapter 会先做一次一对一校验，但 gateway 是可替换的运行时
			// 端口，回放器、测试替身或未来的组合根仍可能绕过 adapter。重复
			// HIS patId 会让两个平台患者在预约、报告或费用查询中指向同一份
			// 临床数据；必须在进入快照事务前整批拒绝，不能依赖数据库唯一键
			// 兜底后才返回一个含糊的持久化错误。
			if (seenHisPatientIds.has(hisPatientId)) {
				invalidPatientDirectoryResult("provider-reference-duplicate");
			}
			seenHisPatientIds.add(hisPatientId);
		}
		return {
			providerPatientId: record.providerPatientId,
			displayName: record.displayName,
			relationship: record.relationship,
			cardNumberMasked: record.cardNumberMasked,
			...(providerReferences ? { providerReferences } : {}),
		};
	});
	return {
		complete: true,
		patients,
		trace,
	};
}

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
	 * Provider 响应返回后、提交快照前由服务端生成的时间。
	 *
	 * 只有携带 operationId 的同步快照要求该字段。持久化层用它和
	 * lease_until 比较，拒绝租约已经过期的旧响应；不能用 observedAt
	 * 代替，因为 observedAt 是请求发出时间，不是响应提交时间。
	 */
	completedAt?: string;
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

/**
 * 开始同步时仓储返回的并发分支。
 *
 * `in_progress` 不只表示相同幂等键正在执行，也表示同一 owner/provider
 * 已经有另一条幂等键占用未过期租约；这样首页与选择页的并发刷新不会重复访问
 * provider。这个互斥只存在于同步启动阶段，成功后新的手动刷新仍可使用新 key。
 */
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
			/** 仅供服务端日志区分重试来源，不进入公共响应。 */
			conflictScope: "same-key" | "owner-provider";
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
 * 服务端生成的平台患者 ID 违反内部身份边界时的固定原因。
 *
 * 这个错误与 Provider 结果校验分开：Provider 患者号已经通过 adapter
 * 白名单校验，异常发生在平台自己的 opaque ID 生成器或组合根注入上。
 * 事务写入前必须拒绝，不能让重复 ID 先落库、再等下一次读取才暴露。
 */
export type PatientDirectoryGeneratedIdViolation =
	| "patient-id-invalid"
	| "patient-id-duplicate";

/** 患者目录同步不会把非法的平台患者 ID 交给持久化层。 */
export class PatientDirectoryGeneratedIdValidationError extends Error {
	readonly violation: PatientDirectoryGeneratedIdViolation;

	constructor(violation: PatientDirectoryGeneratedIdViolation) {
		super("Generated patient directory id is invalid");
		this.name = "PatientDirectoryGeneratedIdValidationError";
		this.violation = violation;
	}
}

/** 患者快照事务返回值违反读模型 contract 时的固定原因。 */
export type PatientDirectorySnapshotResultViolation =
	| "result-not-object"
	| "active-patients-invalid"
	| "deactivated-count-invalid";

/** 快照事务的提交结果不能因为 TypeScript 类型而直接进入成功日志。 */
export class PatientDirectorySnapshotResultValidationError extends Error {
	readonly violation: PatientDirectorySnapshotResultViolation;

	constructor(violation: PatientDirectorySnapshotResultViolation) {
		super("Patient directory snapshot result is invalid");
		this.name = "PatientDirectorySnapshotResultValidationError";
		this.violation = violation;
	}
}

/**
 * 重新投影患者快照事务结果。
 *
 * `replaceDirectorySnapshot` 可能来自 MySQL、回放任务或测试替身；事务提交
 * 成功只证明写入完成，不证明返回的 activePatients 可直接作为日志/页面事实。
 * 患者数组复用 owner-scoped 读模型校验，失效数量只允许非负安全整数。
 */
export function normalizePatientDirectorySnapshotResult(
	value: unknown,
	ownerUserId: string,
): PatientDirectorySnapshotResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new PatientDirectorySnapshotResultValidationError(
			"result-not-object",
		);
	}
	const result = value as Record<string, unknown>;
	let activePatients: PatientRecord[];
	try {
		activePatients = normalizePatientReadModel(
			result.activePatients,
			ownerUserId,
		);
	} catch {
		throw new PatientDirectorySnapshotResultValidationError(
			"active-patients-invalid",
		);
	}
	if (
		typeof result.deactivatedPatientCount !== "number" ||
		!Number.isSafeInteger(result.deactivatedPatientCount) ||
		result.deactivatedPatientCount < 0
	) {
		throw new PatientDirectorySnapshotResultValidationError(
			"deactivated-count-invalid",
		);
	}
	return {
		activePatients,
		deactivatedPatientCount: result.deactivatedPatientCount,
	};
}

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
 * 返回值不重复携带 ownerUserId，owner 隔离由 PatientRepository 的查询合同负责，
 * 各业务 service 仍必须对 patientId、provider 和 providerPatientId 做运行时复核。
 */
export type PatientProviderReference = {
	patientId: string;
	provider: "zhongyang";
	providerPatientId: string;
};

/** 患者 provider 引用在跨层返回时允许写入日志的有限异常原因。 */
export type PatientProviderReferenceViolation =
	| "reference-invalid"
	| "reference-scope-mismatch";

/**
 * 校验服务端仓储返回的患者 provider 引用。
 *
 * TypeScript 类型只约束编译期，不能保护缓存、回放任务或错误仓储实现带来的
 * 运行时对象。ownerUserId 不在返回值中重复携带，owner 隔离仍由 repository
 * 查询合同负责；这里统一复核患者、Provider 和外部患者号，防止各业务 service
 * 把别的患者 patId 发送给 Provider。返回值只允许固定原因，不能把存储字段写入日志。
 */
export function validatePatientProviderReference(
	reference: unknown,
	patientId: string,
): PatientProviderReferenceViolation | undefined {
	if (
		typeof reference !== "object" ||
		reference === null ||
		Array.isArray(reference)
	) {
		return "reference-invalid";
	}
	const candidate = reference as Partial<PatientProviderReference>;
	if (
		!isBoundedOpaqueIdentifier(candidate.patientId) ||
		!isBoundedOpaqueIdentifier(candidate.providerPatientId) ||
		typeof candidate.provider !== "string"
	) {
		return "reference-invalid";
	}
	if (candidate.patientId !== patientId || candidate.provider !== "zhongyang") {
		return "reference-scope-mismatch";
	}
	return undefined;
}

/** 与微信 provider 的 subject 解耦的内部用户身份；业务表只引用 userId。 */
export type IdentityUser = {
	userId: string;
	providerSubject: string;
	unionId?: string;
};

/** 身份仓储读模型违反 owner/Provider 边界时的固定原因。 */
export type IdentityUserReadModelViolation =
	| "result-not-object"
	| "user-id-invalid"
	| "user-id-mismatch"
	| "provider-subject-invalid"
	| "provider-subject-mismatch"
	| "union-id-invalid";

/** 身份仓储返回异常读模型时禁止继续签发会话或调用下游 Provider。 */
export class IdentityUserReadModelValidationError extends Error {
	readonly violation: IdentityUserReadModelViolation;

	constructor(violation: IdentityUserReadModelViolation) {
		super("Identity user read model is invalid");
		this.name = "IdentityUserReadModelValidationError";
		this.violation = violation;
	}
}

function invalidIdentityUserReadModel(
	violation: IdentityUserReadModelViolation,
): never {
	throw new IdentityUserReadModelValidationError(violation);
}

/** 数据库 user_id 的列宽小于通用 opaque 标识上限，不能只依赖 TypeScript 类型。 */
function isSafeIdentityUserId(value: unknown): value is string {
	return isBoundedOpaqueIdentifier(value) && value.length <= 64;
}

/**
 * 校验并重新投影身份仓储结果。
 *
 * 身份仓储是可替换的运行时端口；MySQL 脏数据、内存 fixture 或回放任务
 * 都可能绕过编译期类型。调用方必须传入已知的 owner/provider 期望值，
 * 防止错误的 userId 进入 Redis 会话、错误的 unionId 进入患者 Provider，
 * 以及错误的 providerSubject 被拿去调起支付。未知字段全部丢弃。
 */
export function normalizeIdentityUserReadModel(
	value: unknown,
	options: {
		expectedUserId?: string;
		expectedProviderSubject?: string;
	} = {},
): IdentityUser {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidIdentityUserReadModel("result-not-object");
	}
	const result = value as Record<string, unknown>;
	if (!isSafeIdentityUserId(result.userId)) {
		invalidIdentityUserReadModel("user-id-invalid");
	}
	if (
		options.expectedUserId !== undefined &&
		result.userId !== options.expectedUserId
	) {
		invalidIdentityUserReadModel("user-id-mismatch");
	}
	if (!isBoundedOpaqueIdentifier(result.providerSubject)) {
		invalidIdentityUserReadModel("provider-subject-invalid");
	}
	if (
		options.expectedProviderSubject !== undefined &&
		result.providerSubject !== options.expectedProviderSubject
	) {
		invalidIdentityUserReadModel("provider-subject-mismatch");
	}
	if (
		result.unionId !== undefined &&
		!isBoundedOpaqueIdentifier(result.unionId)
	) {
		invalidIdentityUserReadModel("union-id-invalid");
	}
	return {
		userId: result.userId,
		providerSubject: result.providerSubject,
		...(result.unionId !== undefined ? { unionId: result.unionId } : {}),
	};
}

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

/**
 * 微信身份 gateway 结果违反登录边界时的固定原因。
 *
 * adapter 会先校验微信响应，但 gateway 仍是可替换的运行时端口；AuthService
 * 在写入身份仓储前必须再次确认 provider subject、unionId 和 trace，避免异常
 * 身份值污染 `hp_identity_users`，也避免未经审计的 trace 字段进入日志。
 */
export type WechatIdentityResultViolation =
	| "result-not-object"
	| "provider-subject-invalid"
	| "union-id-invalid"
	| "trace-invalid";

/** 微信身份交换结果不满足平台身份映射 contract。 */
export class WechatIdentityResultValidationError extends Error {
	readonly violation: WechatIdentityResultViolation;

	constructor(violation: WechatIdentityResultViolation) {
		super("Wechat identity provider result is invalid");
		this.name = "WechatIdentityResultValidationError";
		this.violation = violation;
	}
}

function invalidWechatIdentityResult(
	violation: WechatIdentityResultViolation,
): never {
	throw new WechatIdentityResultValidationError(violation);
}

/** 在身份仓储写入前重新投影微信 provider 的最小身份事实。 */
export function normalizeWechatIdentityResult(value: unknown): {
	providerSubject: string;
	unionId?: string;
	trace: ExternalTrace;
} {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidWechatIdentityResult("result-not-object");
	}
	const result = value as Record<string, unknown>;
	if (!isBoundedOpaqueIdentifier(result.providerSubject)) {
		invalidWechatIdentityResult("provider-subject-invalid");
	}
	if (
		result.unionId !== undefined &&
		!isBoundedOpaqueIdentifier(result.unionId)
	) {
		invalidWechatIdentityResult("union-id-invalid");
	}
	if (
		typeof result.trace !== "object" ||
		result.trace === null ||
		Array.isArray(result.trace)
	) {
		invalidWechatIdentityResult("trace-invalid");
	}
	const trace = result.trace as Record<string, unknown>;
	if (
		trace.provider !== "wechat-identity" ||
		trace.operation !== "code2session" ||
		!hasSafePatientText(trace.requestId, 128)
	) {
		invalidWechatIdentityResult("trace-invalid");
	}
	return {
		providerSubject: result.providerSubject,
		...(result.unionId !== undefined ? { unionId: result.unionId } : {}),
		trace: {
			provider: "wechat-identity",
			operation: "code2session",
			requestId: trace.requestId,
		},
	};
}
