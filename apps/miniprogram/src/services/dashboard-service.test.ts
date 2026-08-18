import { expect, test } from "bun:test";
import {
	createAppointmentRecordDateRange,
	createAppointmentRecordQuery,
	createPastDateRange,
	loadOutpatientPaymentRecords,
	requireAppointmentRecordListData,
	requireExactListData,
	requireOutpatientPaymentListData,
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

test("预约查询拒绝损坏的本地患者标识", () => {
	// 页面参数或本地缓存损坏时，空白、控制字符和超长值都必须在网络请求前
	// 收敛为患者上下文错误；服务端仍会执行最终 owner 校验，这里不是授权替代。
	for (const patientId of [
		" ",
		"\tpatient-internal-001",
		"patient-internal-001\n",
		"x".repeat(129),
	]) {
		expect(() =>
			createAppointmentRecordQuery(patientId, BEIJING_MIDNIGHT),
		).toThrow("请先登录并选择就诊人");
	}
});

test("门诊费用查询先拒绝空患者标识，不把无效查询交给 API", () => {
	// 这里必须在 requestWithSession 之前失败；否则页面会把患者上下文问题
	// 误报成接口参数错误，且会产生一条没有业务意义的网络日志。
	expect(() => loadOutpatientPaymentRecords("", "unpaid")).toThrow(
		"请先登录并选择就诊人",
	);
});

test("患者端列表响应要求 total 与完整 items 数量一致", () => {
	const items = [{ id: "patient-001" }];
	expect(requireExactListData<{ id: string }>({ items, total: 1 })).toEqual({
		items,
		total: 1,
	});
});

test("患者端列表响应 total 不一致时 fail-closed，不伪装成空列表", () => {
	for (const value of [
		{ items: [{ id: "patient-001" }], total: 0 },
		{ items: [], total: 1 },
		{ items: [{ id: "patient-001" }], total: 1.5 },
		{ items: [{ id: "patient-001" }], total: -1 },
		{ items: "not-an-array", total: 0 },
	]) {
		expect(() => requireExactListData(value)).toThrow("Patient list response");
	}
});

test("门诊费用列表必须保持查询状态和公共记录字段一致", () => {
	const valid = {
		status: "unpaid" as const,
		items: [
			{
				recordId: "fee-001",
				status: "unpaid" as const,
				billDate: "2026-08-15 10:20:30",
				amountFen: 1234,
			},
		],
		total: 1,
	};
	expect(requireOutpatientPaymentListData(valid, "unpaid")).toEqual({
		items: valid.items,
		total: valid.total,
	});

	for (const invalid of [
		{ ...valid, status: "paid" },
		{ ...valid, items: [{ ...valid.items[0], status: "paid" }] },
		{ ...valid, items: [{ ...valid.items[0], amountFen: 12.5 }] },
		{ ...valid, items: [{ ...valid.items[0], recordId: "" }] },
		{ ...valid, items: [{ ...valid.items[0], billDate: null }] },
	]) {
		expect(() => requireOutpatientPaymentListData(invalid, "unpaid")).toThrow(
			"Outpatient payment response",
		);
	}
});

test("我的挂号列表必须保持公共状态、日期和展示字段一致", () => {
	const valid = {
		items: [
			{
				status: "scheduled" as const,
				workDate: "2026-08-15",
				departmentName: "内科",
				workTime: "09:00-09:30",
			},
		],
		total: 1,
	};
	expect(requireAppointmentRecordListData(valid)).toEqual(valid);

	for (const invalid of [
		{ items: [{ ...valid.items[0], status: "not-a-status" }], total: 1 },
		{ items: [{ ...valid.items[0], workDate: "2026-02-31" }], total: 1 },
		{ items: [{ ...valid.items[0], departmentName: null }], total: 1 },
		{ items: [{ ...valid.items[0], serialNumber: "" }], total: 1 },
	]) {
		expect(() => requireAppointmentRecordListData(invalid)).toThrow(
			"Appointment record response",
		);
	}
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
