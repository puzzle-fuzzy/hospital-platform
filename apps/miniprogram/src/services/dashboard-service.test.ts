import { expect, test } from "bun:test";
import {
	createAppointmentRecordDateRange,
	createAppointmentRecordQuery,
	createPastDateRange,
} from "./dashboard-service";

// 2026-08-15 00:00:00 Asia/Shanghai 对应 UTC 前一天 16:00。
const BEIJING_MIDNIGHT = new Date("2026-08-14T16:00:00.000Z");

test("预约历史查询使用中国标准时间前后各 90 天", () => {
	expect(
		createAppointmentRecordQuery("patient-internal-001", BEIJING_MIDNIGHT),
	).toEqual({
		patientId: "patient-internal-001",
		startDate: "2026-05-17",
		endDate: "2026-11-13",
	});
});

test("爽约查询只使用过去 90 天，不把未来预约混入派生视图", () => {
	expect(
		createAppointmentRecordQuery(
			"patient-internal-001",
			BEIJING_MIDNIGHT,
			"missed",
		),
	).toEqual({
		patientId: "patient-internal-001",
		...createPastDateRange(90, BEIJING_MIDNIGHT),
	});
});

test("预约查询先拒绝空患者标识，不允许生成跨患者请求", () => {
	expect(() => createAppointmentRecordQuery("", BEIJING_MIDNIGHT)).toThrow(
		"请先登录并选择就诊人",
	);
});

test("历史和爽约窗口使用同一中国标准时间自然日基准", () => {
	const history = createAppointmentRecordDateRange(BEIJING_MIDNIGHT);
	const missed = createAppointmentRecordQuery(
		"patient-internal-001",
		BEIJING_MIDNIGHT,
		"missed",
	);

	// 两个查询都必须以 2026-08-15 为今天；区别只能是业务窗口长度，
	// 不能因为调用页面不同而落回设备或服务器本地时区。
	expect(history.startDate).toBe("2026-05-17");
	expect(history.endDate).toBe("2026-11-13");
	expect(missed.endDate).toBe("2026-08-15");
});
