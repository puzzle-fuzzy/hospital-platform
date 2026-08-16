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
