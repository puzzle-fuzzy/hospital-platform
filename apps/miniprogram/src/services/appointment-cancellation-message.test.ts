import { afterEach, expect, test } from "bun:test";
import { normalizeAppointmentCancellationMessage as normalizeContractMessage } from "@hospital/contracts";
import { normalizeAppointmentCancellationMessage } from "./appointment-cancellation-message";
import { getSessionGeneration } from "./session-generation";

const HIS_MESSAGE = "临近就诊时间，不能取消预约，请去门诊窗口处理";

test("小程序与服务端取消原因校验一致，保留真实业务提示并拒绝敏感或内部数据", () => {
	const examples: unknown[] = [
		HIS_MESSAGE,
		"  预约已取号，请到门诊窗口办理取消  ",
		"挂号已超过取消时限，请到窗口办理",
		"取消预约需提前30分钟办理",
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
		"取消预约失败：连接超时",
		"取消预约失败：mysql connection failed",
		"取消预约失败：10.0.0.1",
	];
	for (const example of examples) {
		expect(normalizeAppointmentCancellationMessage(example)).toBe(
			normalizeContractMessage(example),
		);
	}
	expect(normalizeAppointmentCancellationMessage(HIS_MESSAGE)).toBe(
		HIS_MESSAGE,
	);
	expect(
		normalizeAppointmentCancellationMessage("取消预约失败 SQLSTATE 42S02"),
	).toBeUndefined();
});

test("医院取消业务提示不展示内部连接、数据库或 IP 诊断", () => {
	for (const message of [
		"取消预约失败：Connection refused 10.0.0.1:5432",
		"取消预约失败：数据库连接错误",
		"取消预约失败，ECONNREFUSED",
		"取消预约失败：连接超时",
		"取消预约失败：mysql connection failed",
		"取消预约失败：10.0.0.1",
	]) {
		expect(normalizeAppointmentCancellationMessage(message)).toBeUndefined();
		expect(normalizeContractMessage(message)).toBeUndefined();
	}
});

type TestPage = {
	data: Record<string, unknown>;
	setData(patch: Record<string, unknown>): void;
	onViewExistingAppointment(): void;
	onCancel(): void;
	submitRegistration(): void;
};
type ModalOptions = {
	title?: string;
	content?: string;
	showCancel?: boolean;
	success?: (result: { confirm: boolean; cancel: boolean }) => void;
};
type RequestOptions = {
	url: string;
	method?: string;
	success(response: unknown): void;
};

const originalGlobals = new Map(
	["wx", "getApp", "Page"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
);
afterEach(() => {
	for (const [name, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});

async function cancellationPage(
	name: "confirm-registration" | "appointment-detail",
) {
	let definition: TestPage | undefined;
	let registrationCalls = 0;
	const calls: string[] = [];
	const redirects: string[] = [];
	const modals: ModalOptions[] = [];
	const toasts: { title: string; icon: string }[] = [];
	const app = {
		globalData: {
			apiBaseUrl: "https://hospital.example.test",
			apiPrefix: "/api/v2",
			accessToken: "cancellation-page-session",
			sessionStatus: "signed_in",
		},
	};
	Object.assign(globalThis, {
		getApp: () => app,
		Page: (page: TestPage) => {
			definition = page;
		},
		wx: {
			getStorageSync: (key: string) =>
				key === "selected_patient_id" ? "patient-001" : "",
			getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
			request: (options: RequestOptions) => {
				calls.push(`${options.method} ${new URL(options.url).pathname}`);
				options.success({
					statusCode: 409,
					data: {
						success: false,
						error: {
							code: "appointment-cancellation-rejected",
							numericCode: 30485,
							message: HIS_MESSAGE,
						},
					},
				});
			},
			showModal: (options: ModalOptions) => {
				modals.push(options);
				options.success?.({ confirm: true, cancel: false });
			},
			showToast: (options: { title: string; icon: string }) =>
				toasts.push(options),
			redirectTo: (options: { url: string }) => redirects.push(options.url),
		},
	});
	// 独立模块实例避免同进程其他页面测试的 import 缓存绕过 Page 捕获。
	const modulePath = `../pages/${name}/${name}.ts?cancellation-rejection-test`;
	await import(modulePath);
	if (!definition) throw new Error(`${name} page was not registered`);
	const page: TestPage = {
		...definition,
		data: {
			...definition.data,
			patientId: "patient-001",
			patientLoading: false,
			sessionGeneration: getSessionGeneration(),
		},
		setData(patch) {
			Object.assign(this.data, patch);
		},
		submitRegistration() {
			registrationCalls += 1;
		},
	};
	return {
		page,
		calls,
		redirects,
		modals,
		toasts,
		registrationCalls: () => registrationCalls,
	};
}

test("确认页原预约操作仅打开详情，不发取消或重新预约", async () => {
	const fixture = await cancellationPage("confirm-registration");
	const duplicate = {
		appointmentId: "appointment-001",
		patientId: "patient-001",
		status: "duplicate",
	};
	Object.assign(fixture.page.data, {
		duplicate,
		duplicateDetected: true,
		duplicatePatientId: "patient-001",
		duplicateSessionGeneration: getSessionGeneration(),
		submitting: false,
	});
	fixture.page.onViewExistingAppointment();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(fixture.page.data.error).toBe("");
	expect(fixture.page.data.duplicate).toBe(duplicate);
	expect(fixture.page.data.submitting).toBeFalse();
	expect(fixture.registrationCalls()).toBe(0);
	expect(fixture.calls).toEqual([]);
	expect(fixture.redirects).toEqual([
		"/pages/appointment-detail/appointment-detail?patientId=patient-001&appointmentId=appointment-001",
	]);
	expect(fixture.toasts).toHaveLength(0);
});

test("普通预约详情取消失败用完整弹窗显示医院原因，保留预约状态", async () => {
	const fixture = await cancellationPage("appointment-detail");
	Object.assign(fixture.page.data, {
		loading: false,
		localDetail: true,
		appointmentId: "appointment-001",
		canCancel: true,
		canPay: true,
		canceling: false,
		status: "scheduled",
	});
	fixture.page.onCancel();
	expect(fixture.modals[0]?.content).toContain("确认向医院申请取消这条预约");
	expect(fixture.modals[0]?.content).toContain(
		"取消结果及是否退费以医院处理结果为准",
	);
	expect(fixture.modals[0]?.content).not.toContain("先办理并核对原路全额退款");
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(fixture.modals.at(-1)).toMatchObject({
		title: "取消预约失败",
		content: HIS_MESSAGE,
		showCancel: false,
	});
	expect(fixture.page.data.status).toBe("scheduled");
	expect(fixture.page.data.canCancel).toBeTrue();
	expect(fixture.page.data.canPay).toBeTrue();
	expect(fixture.page.data.canceling).toBeFalse();
	expect(fixture.calls).toEqual([
		"POST /api/v2/appointments/registrations/appointment-001/cancel",
	]);
	expect(fixture.toasts).toHaveLength(0);
});
