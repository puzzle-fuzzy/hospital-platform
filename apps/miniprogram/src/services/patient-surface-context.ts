import type { Patient } from "../types";
import { ApiError, getCurrentUser } from "./api-client";
import { loadCurrentPatientForOwner } from "./dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
	invalidatePageRequests,
} from "./page-instance-state";
import { patientScopedErrorMessage } from "./patient-selection-service";
import { registerSessionChangedListener } from "./session-events";
import { assertSessionGeneration } from "./session-boundary";

/**
 * 关闭态页面可以展示的当前就诊人上下文。
 *
 * 这里故意只保留服务端已经脱敏的姓名和卡号展示值，不把 provider 患者号、
 * 身份证号或内部映射字段带入页面。这个上下文只用于告诉用户“后续业务
 * 将针对谁”，不代表病历、住院、医生或问卷数据已经开放。
 */
export type PatientSurfaceContextData = {
	currentPatient: Patient | null;
	currentPatientName: string;
	currentPatientCardLabel: string;
	patientActionLabel: string;
	patientContextLoading: boolean;
	patientContextLoaded: boolean;
	patientContextError: string;
};

/** 首次渲染的固定高度状态，避免加载态和空态切换时页面突然增高。 */
export const INITIAL_PATIENT_SURFACE_CONTEXT: PatientSurfaceContextData = {
	currentPatient: null,
	currentPatientName: "正在获取就诊人...",
	currentPatientCardLabel: "就诊卡信息加载中",
	patientActionLabel: "选择就诊人",
	patientContextLoading: true,
	patientContextLoaded: false,
	patientContextError: "",
};

type PatientSurfaceContextPage = {
	data: PatientSurfaceContextData;
	setData(data: Partial<PatientSurfaceContextData>): void;
};

type PatientSurfaceContextRuntime = {
	/** 这张卡片最后一次成功确认的会话代际；-1 表示尚未确认。 */
	sessionGeneration: number;
	/** 页面卸载后阻止已复制到事件队列的旧回调继续 setData。 */
	disposed: boolean;
	unsubscribe: () => void;
};

/**
 * 页面外壳的非渲染运行态必须按页面实例隔离。
 *
 * 不能把“当前患者是否属于本会话”放进模块级变量：多个页面实例可能同时
 * 存在，模块变量会让一个页面的会话切换清掉另一个页面的门禁。WeakMap 只
 * 保存当前页面的取消订阅句柄和会话代际，不进入 WXML、storage 或日志。
 */
const patientSurfaceRuntimes = new WeakMap<
	PatientSurfaceContextPage,
	PatientSurfaceContextRuntime
>();

/** 将患者目录错误稳定翻译为用户可理解的页面状态。 */
export function patientSurfaceErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		switch (error.code) {
			case "patient-selection-required":
			case "patient-not-bound":
				return "当前还没有可用的就诊人，请先选择就诊人";
			case "patient-selection-stale":
				return "上次选择的就诊人已失效，请重新选择";
			case "patient-clinical-unavailable":
				return "当前就诊人暂不可用于该服务，请更换就诊人";
			case "persistence-temporarily-unavailable":
				return "就诊人信息暂时不可用，请稍后重试";
		}
	}
	return patientScopedErrorMessage(error, "就诊人信息暂时无法加载，请重试");
}

/** 将已校验患者投影为关闭态页面可以展示的脱敏字段。 */
export function toPatientSurfaceData(
	patient: Patient | null,
): Partial<PatientSurfaceContextData> {
	if (!patient) {
		return {
			currentPatient: null,
			currentPatientName: "未选择就诊人",
			currentPatientCardLabel: "就诊卡信息不可用",
			patientActionLabel: "选择就诊人",
		};
	}

	return {
		currentPatient: patient,
		currentPatientName: patient.displayName,
		// cardNumberMasked 已在公共 response contract 中完成脱敏；页面不再
		// 自己截取身份证、卡号或展示 provider 原始编号，避免不同页面脱敏规则漂移。
		currentPatientCardLabel:
			patient.cardNumberMasked === "未绑定"
				? "就诊卡未绑定"
				: `就诊卡：${patient.cardNumberMasked}`,
		patientActionLabel: "更换就诊人",
	};
}

/**
 * 会话变化时统一清理患者外壳。
 *
 * 账号切换不等于“当前账号暂时没有患者”，所以这里保留明确的重新读取
 * 文案，并把 `patientContextLoaded` 退回 false；页面不能把上一账号的卡片
 * 留在界面上，也不能把清理动作伪装成成功空结果。真正的重新读取由页面的
 * onShow、重试或用户重新进入业务入口触发，避免在 `setAccessToken` 尚未
 * 写入新 token 的通知回调中立即发起请求。
 */
export function patientSurfaceSessionReset(): Partial<PatientSurfaceContextData> {
	return {
		...toPatientSurfaceData(null),
		patientContextLoading: false,
		patientContextLoaded: false,
		patientContextError: "登录账号已切换，请重新读取就诊人",
	};
}

function ensurePatientSurfaceRuntime(
	page: PatientSurfaceContextPage,
): PatientSurfaceContextRuntime {
	const existing = patientSurfaceRuntimes.get(page);
	if (existing) return existing;

	const runtime: PatientSurfaceContextRuntime = {
		sessionGeneration: -1,
		disposed: false,
		unsubscribe: () => undefined,
	};
	runtime.unsubscribe = registerSessionChangedListener(() => {
		// `notifySessionChanged` 会复制监听器后再执行；即使页面恰好在
		// 通知期间卸载，disposed 也必须阻止回调越过页面生命周期边界。
		if (runtime.disposed || runtime.sessionGeneration < 0) return;
		// 共享患者外壳没有使用页面级 reset 工厂，因此这里显式淘汰该页面
		// 所有 guard；否则目录请求在会话通知后晚返回，仍可能覆盖清理态。
		invalidatePageRequests(page);
		runtime.sessionGeneration = -1;
		page.setData(patientSurfaceSessionReset());
	});
	patientSurfaceRuntimes.set(page, runtime);
	return runtime;
}

/**
 * 读取关闭态页面的当前就诊人。
 *
 * 每个页面实例有自己的 request guard：用户从选择页返回、连续点击重试或
 * 页面卸载时，旧目录响应都失去回写资格。这里不调用同步 Provider，因为
 * 关闭态页面只需要当前平台目录；把“展示上下文”升级成“外部同步命令”会
 * 让多个页面互相争抢同步租约，也会把用户仅仅打开页面误记成业务操作。
 */
export function loadPatientSurfaceContext(
	page: PatientSurfaceContextPage,
	guardKey: string,
): Promise<void> {
	const runtime = ensurePatientSurfaceRuntime(page);
	const guard = getPageLatestRequestGuard(page, guardKey);
	const token = guard.begin();
	// 新一轮读取开始后，上一轮卡片不再有可提交资格；WXML 的 loading
	// 分支会遮住旧字段，最终仍必须等待同一 owner 的目录快照确认。
	runtime.sessionGeneration = -1;
	page.setData({
		patientContextLoading: true,
		patientContextLoaded: false,
		patientContextError: "",
	});

	return getCurrentUser()
		.then((currentUser) => {
			if (!guard.isCurrent(token)) return undefined;
			// 关闭态页面虽然没有临床业务请求，也不能只依赖当前 token
			// 存在；先取得 owner，再复用完整的目录 + owner 重验证 helper，
			// 防止账号切换窗口把旧患者卡片组合进新会话。
			return loadCurrentPatientForOwner(currentUser.data.user.id);
		})
		.then((patientContext) => {
			if (!patientContext || !guard.isCurrent(token)) return;
			assertSessionGeneration(
				patientContext.sessionGeneration,
				"Patient surface session changed before context was committed",
			);
			runtime.sessionGeneration = patientContext.sessionGeneration;
			page.setData({
				...toPatientSurfaceData(patientContext.patient),
				patientContextError: "",
			});
		})
		.catch((error: unknown) => {
			if (!guard.isCurrent(token)) return;
			runtime.sessionGeneration = -1;
			page.setData({
				...toPatientSurfaceData(null),
				patientContextError: patientSurfaceErrorMessage(error),
			});
		})
		.finally(() => {
			if (!guard.isCurrent(token)) return;
			page.setData({
				patientContextLoading: false,
				patientContextLoaded: true,
			});
		});
}

/** 关闭态页面统一销毁入口，防止目录 Promise 在页面卸载后继续 setData。 */
export function disposePatientSurfaceContext(page: object): void {
	const runtime = patientSurfaceRuntimes.get(page as PatientSurfaceContextPage);
	if (runtime) {
		runtime.disposed = true;
		runtime.unsubscribe();
		patientSurfaceRuntimes.delete(page as PatientSurfaceContextPage);
	}
	disposePageInstance(page);
}
