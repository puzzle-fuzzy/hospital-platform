import { expect, test } from "bun:test";
import { resolvePatientExpressRecordState } from "./patient-express-state";

test("我的快递在读取患者期间不展示物流空记录", () => {
	expect(resolvePatientExpressRecordState(true, "")).toBe("loading");
	// 重试刚开始时 loading 必须压过旧错误，避免短暂显示错误和空态的混合页面。
	expect(resolvePatientExpressRecordState(true, "上一次读取失败")).toBe(
		"loading",
	);
});

test("我的快递读取失败时不把服务故障伪装成空记录", () => {
	expect(resolvePatientExpressRecordState(false, "数据服务暂时不可用")).toBe(
		"error",
	);
});

test("患者读取成功后进入受控的物流未开放状态", () => {
	expect(resolvePatientExpressRecordState(false, "")).toBe("unavailable");
});
