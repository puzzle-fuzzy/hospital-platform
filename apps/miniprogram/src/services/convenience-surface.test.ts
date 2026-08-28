import { expect, test } from "bun:test";
import { ApiError } from "./api-client";
import {
	convenienceSurfaceErrorMessage,
	resolveConvenienceSurfaceRecordState,
} from "./convenience-surface";

test("便民记录区域在患者读取期间保持加载态", () => {
	expect(resolveConvenienceSurfaceRecordState(true, "")).toBe("loading");
	// 新一轮重试开始时必须优先展示 loading，不能短暂显示上一次的错误或
	// “公开记录暂未开放”，否则用户会把状态变化误认为查询已完成。
	expect(resolveConvenienceSurfaceRecordState(true, "上一次读取失败")).toBe(
		"loading",
	);
});

test("便民记录区域不把患者读取故障伪装成空记录", () => {
	expect(
		resolveConvenienceSurfaceRecordState(false, "数据服务暂时不可用"),
	).toBe("error");
});

test("便民记录区域仅在患者读取成功后进入未开放态", () => {
	expect(resolveConvenienceSurfaceRecordState(false, "")).toBe("unavailable");
});

test("便民页面区分患者选择错误与服务暂不可用", () => {
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("patient is not bound", { code: "patient-not-bound" }),
		),
	).toBe("暂未添加就诊人，请先添加");
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("patient selection is stale", {
				code: "patient-selection-stale",
			}),
		),
	).toBe("请选择就诊人后再继续");
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("clinical mapping is unavailable", {
				code: "patient-clinical-unavailable",
			}),
		),
	).toBe("该就诊人暂时无法使用此服务，请更换就诊人");
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("persistence is unavailable", {
				code: "persistence-temporarily-unavailable",
			}),
		),
	).toBe("就诊人信息暂时无法获取，请稍后再试");
});

test("便民页面保留登录失效与依赖未配置的操作引导", () => {
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("session expired", { code: "unauthorized" }),
		),
	).toBe("登录已过期，请返回首页重新登录");
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("dependency is not configured", {
				code: "dependency-not-configured",
			}),
		),
	).toBe("暂时无法获取就诊人，请稍后再试");
	expect(convenienceSurfaceErrorMessage(new Error("内部原文不应展示"))).toBe(
		"就诊人信息暂时无法获取，请稍后再试",
	);
});
