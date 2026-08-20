export class DependencyNotConfiguredError extends Error {
	readonly dependency: string;

	constructor(dependency: string) {
		super(`Dependency is not configured: ${dependency}`);
		this.name = "DependencyNotConfiguredError";
		this.dependency = dependency;
	}
}

/**
 * 同一个 owner 的患者目录同步仍在租约内执行。
 *
 * 这是业务并发冲突，不是 provider 故障；API 应返回 409，让小程序稍后刷新，
 * 不能在这里再次访问 provider 或把请求伪装成成功。
 */
export class PatientDirectorySyncInProgressError extends Error {
	constructor() {
		super("Patient directory synchronization is already in progress");
		this.name = "PatientDirectorySyncInProgressError";
	}
}

/**
 * Provider 返回空患者目录，但当前 owner 已有医院目录患者，快照不能安全应用。
 *
 * 空数组只有在 Provider contract 明确区分“确实没有绑定患者”和“响应不完整、
 * 权限过滤或临时异常”后，才可以驱动失效回收。当前证据不足时必须保留旧目录，
 * 不能把不确定结果当成用户主动解绑，更不能批量停用已有就诊人。
 */
export class PatientDirectorySnapshotUnsafeError extends Error {
	constructor() {
		super("Patient directory snapshot is unsafe to apply");
		this.name = "PatientDirectorySnapshotUnsafeError";
	}
}

/**
 * 患者目录快照已经落后于同一 owner/provider 的更新快照。
 *
 * 旧请求即使仍持有未清理的租约，也不能覆盖新一轮已经提交的目录；
 * 这属于并发冲突而不是 Provider 故障，调用方应刷新当前读模型。
 */
export class PatientDirectorySnapshotStaleError extends Error {
	constructor() {
		super("Patient directory snapshot is stale");
		this.name = "PatientDirectorySnapshotStaleError";
	}
}
