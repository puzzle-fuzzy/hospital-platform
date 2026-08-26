import { expect, test } from "bun:test";
import { ApiError } from "./api-client";
import { convenienceSurfaceErrorMessage } from "./convenience-surface";

test("便民页面区分患者选择错误与服务暂不可用", () => {
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("patient is not bound", { code: "patient-not-bound" }),
		),
	).toBe("当前微信账号暂无绑定的就诊人");
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("patient selection is stale", {
				code: "patient-selection-stale",
			}),
		),
	).toBe("上次选择的就诊人已失效，请重新选择");
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("clinical mapping is unavailable", {
				code: "patient-clinical-unavailable",
			}),
		),
	).toBe("该就诊人暂未完成医院档案映射，请选择其他就诊人或刷新");
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("persistence is unavailable", {
				code: "persistence-temporarily-unavailable",
			}),
		),
	).toBe("数据服务暂时不可用，请稍后重试");
});

test("便民页面保留登录失效与依赖未配置的操作引导", () => {
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("session expired", { code: "unauthorized" }),
		),
	).toBe("登录状态已失效，请返回首页重新登录");
	expect(
		convenienceSurfaceErrorMessage(
			new ApiError("dependency is not configured", {
				code: "dependency-not-configured",
			}),
		),
	).toBe("就诊人服务暂不可用，请稍后重试");
	expect(convenienceSurfaceErrorMessage(new Error("内部原文不应展示"))).toBe(
		"就诊人信息暂时无法加载，请重试",
	);
});
