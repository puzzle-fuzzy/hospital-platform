import { expect, test } from "bun:test";
import { normalizeAppointmentCancellationMessage } from "./appointment-cancellation-message";

test("HIS 临近就诊时间提示原样保留，不推导截止时间", () => {
	const message = "临近就诊时间，不能取消预约，请去门诊窗口处理";
	expect(normalizeAppointmentCancellationMessage(message)).toBe(message);
	expect(
		normalizeAppointmentCancellationMessage(
			"  预约已取号，请到门诊窗口办理取消  ",
		),
	).toBe("预约已取号，请到门诊窗口办理取消");
});

test("取消业务提示只接受简短正文，拒绝不可见字符、患者信息及内部数据", () => {
	const rejected: unknown[] = [
		undefined,
		null,
		42,
		{ message: "不能取消预约" },
		"",
		"  ",
		"服务暂不可用",
		`取消预约${"原".repeat(157)}`,
		"不能取消预约\n请去门诊窗口处理",
		"不能取消预约\u202e请去门诊窗口处理",
		"不能取消预约\u200b请去门诊窗口处理",
		"不能取消预约<script>alert(1)</script>",
		"不能取消预约&lt;script&gt;",
		"取消预约失败 SQLSTATE 42S02",
		"取消预约失败 java.lang.Exception: error",
		"取消预约失败 at CancellationService.cancel(Service.java:42)",
		"取消预约失败 requestId=req-001",
		"取消预约失败 patId=123",
		"取消预约失败 patientName=测试患者",
		"取消预约失败患者身份证号码无效",
		"取消预约失败，手机号13800000000",
		"取消预约失败，token=private-value",
		"取消预约失败，session_key=private-value",
		"取消预约失败，患者编号12345678",
		"取消预约失败 abcdefghijklmnopqrstuvwxyz0123456789",
		"取消预约失败 https://provider.example.test/internal",
		"取消预约失败：Connection refused 10.0.0.1:5432",
		"取消预约失败：数据库连接错误",
		"取消预约失败，ECONNREFUSED",
		"取消预约失败，ETIMEDOUT",
		"取消预约失败，db连接错误",
		"取消预约失败，10.0.0.1:5432",
	];
	for (const message of rejected) {
		expect(normalizeAppointmentCancellationMessage(message)).toBeUndefined();
	}
});
