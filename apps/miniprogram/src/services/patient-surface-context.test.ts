import { afterEach, expect, test } from "bun:test";
import { ApiError } from "./api-client";
import {
	patientSurfaceErrorMessage,
	patientSurfaceReloadState,
	patientSurfaceSessionReset,
	toPatientSurfaceData,
} from "./patient-surface-context";

const patient = {
	id: "patient-opaque-001",
	displayName: "患者甲",
	relationship: "self" as const,
	cardNumberMasked: "00100******7027",
	source: "hospital-his" as const,
	clinicalAccess: "ready" as const,
};

const runtime = globalThis as typeof globalThis & { wx?: typeof wx };
const originalWx = runtime.wx;

afterEach(() => {
	if (originalWx) runtime.wx = originalWx;
	else delete runtime.wx;
});

test("关闭态患者卡片只投影脱敏卡号，不展示内部患者 ID", () => {
	const data = toPatientSurfaceData(patient);

	expect(data.currentPatientName).toBe("患者甲");
	expect(data.currentPatientCardLabel).toBe("就诊卡：00100******7027");
	expect(data.patientActionLabel).toBe("更换就诊人");
	expect(data.currentPatientCardLabel).not.toContain(patient.id);
});

test("没有患者时保持可解释的选择入口", () => {
	const data = toPatientSurfaceData(null);

	expect(data.currentPatient).toBeNull();
	expect(data.currentPatientName).toBe("未选择就诊人");
	expect(data.patientActionLabel).toBe("选择就诊人");
});

test("会话变化时患者外壳清理旧卡片并回到加载状态", () => {
	const data = patientSurfaceSessionReset();

	expect(data.currentPatient).toBeNull();
	expect(data.currentPatientName).toBe("未选择就诊人");
	expect(data.currentPatientCardLabel).toBe("请先选择就诊人");
	expect(data.patientActionLabel).toBe("选择就诊人");
	expect(data.patientContextLoading).toBe(true);
	expect(data.patientContextLoaded).toBe(false);
	expect(data.patientContextError).toBe("");
});

test("同一患者刷新时保留已确认卡片，避免加载态闪回", () => {
	runtime.wx = {
		getStorageSync: () => patient.id,
	} as unknown as typeof wx;

	const data = patientSurfaceReloadState(patient);

	expect(data.currentPatient).toEqual(patient);
	expect(data.currentPatientName).toBe("患者甲");
	expect(data.patientContextLoading).toBe(true);
	expect(data.patientContextLoaded).toBe(true);
	expect(data.patientContextError).toBe("");
});

test("患者选择已经变化时刷新不能保留旧卡片", () => {
	runtime.wx = {
		getStorageSync: () => "patient-opaque-002",
	} as unknown as typeof wx;

	const data = patientSurfaceReloadState(patient);

	expect(data.currentPatient).toBeNull();
	expect(data.currentPatientName).toBe("未选择就诊人");
	expect(data.patientContextLoading).toBe(true);
	expect(data.patientContextLoaded).toBe(false);
});

test("患者目录错误保持失效、映射不可用和暂时故障的区别", () => {
	expect(
		patientSurfaceErrorMessage(
			new ApiError("expired", { code: "unauthorized" }),
		),
	).toBe("登录已过期，请返回首页重新登录");
	expect(
		patientSurfaceErrorMessage(
			new ApiError("unavailable", { code: "patient-clinical-unavailable" }),
		),
	).toBe("该就诊人暂时无法使用此服务，请更换就诊人");
	expect(
		patientSurfaceErrorMessage(
			new ApiError("not bound", { code: "patient-not-bound" }),
		),
	).toBe("当前还没有可用的就诊人，请先选择就诊人");
	expect(
		patientSurfaceErrorMessage(
			new ApiError("stale", { code: "patient-selection-stale" }),
		),
	).toBe("请选择就诊人后再继续");
	expect(
		patientSurfaceErrorMessage(
			new ApiError("dependency", { code: "dependency-not-configured" }),
		),
	).toBe("就诊人服务暂时不可用，请稍后再试");
	expect(
		patientSurfaceErrorMessage(
			new ApiError("temporary", {
				code: "persistence-temporarily-unavailable",
			}),
		),
	).toBe("就诊人信息暂时无法获取，请稍后再试");
});
