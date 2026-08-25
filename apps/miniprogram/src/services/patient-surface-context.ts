import type { Patient } from "../types";
import { ApiError } from "./api-client";
import { loadCurrentPatient } from "./dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "./page-instance-state";

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

/** 将患者目录错误稳定翻译为用户可理解的页面状态。 */
export function patientSurfaceErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		switch (error.code) {
			case "unauthorized":
				return "登录状态已失效，请返回首页重新登录";
			case "patient-selection-required":
				return "当前还没有可用的就诊人，请先选择就诊人";
			case "patient-clinical-unavailable":
				return "当前就诊人暂不可用于该服务，请更换就诊人";
			case "persistence-temporarily-unavailable":
				return "就诊人信息暂时不可用，请稍后重试";
		}
	}
	return "就诊人信息暂时无法加载，请重试";
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
	const guard = getPageLatestRequestGuard(page, guardKey);
	const token = guard.begin();
	page.setData({
		patientContextLoading: true,
		patientContextLoaded: false,
		patientContextError: "",
	});

	return loadCurrentPatient()
		.then((patient) => {
			if (!guard.isCurrent(token)) return;
			page.setData({
				...toPatientSurfaceData(patient),
				patientContextError: "",
			});
		})
		.catch((error: unknown) => {
			if (!guard.isCurrent(token)) return;
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
	disposePageInstance(page);
}
