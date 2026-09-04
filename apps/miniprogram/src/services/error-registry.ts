/**
 * 客户端错误数字码注册表（纯数据层，禁止 import 其他服务模块）。
 *
 * 数字码是排障定位索引：用户反馈"错误码 30210"时，维护者可以在
 * `docs/错误码.md` 反查原因说明和 grep 关键字，再结合遥测事件里的
 * route/method/requestId 还原完整链路。规则：
 *
 * - 服务端错误码的数字由 `apps/api/src/plugins/error-handler.ts` 的
 *   `ERROR_NUMERIC_CODES` 权威分配；本文件持有镜像，部署窗口内旧服务
 *   响应缺少 `numericCode` 字段时按镜像回退。镜像与服务端表由
 *   `tools/error-contract-audit.mjs` 强制同步。
 * - 80xxx 是客户端本地保留段（服务端永不使用），覆盖网络、微信登录、
 *   会话替换、就诊人选择、支付调起等未到服务端的失败。
 * - 一个数字唯一对应一个原因；"哪个部分"由展示层的 surface 标题补充。
 * - 客户端不得用数字码替代字符串码做程序分支；数字只用于展示与检索。
 */

export const SERVER_ERROR_NUMERIC_CODES = Object.freeze({
	validation: 10100,
	unauthorized: 10200,
	parse: 10300,
	"not-found": 10400,
	"dependency-not-configured": 10500,
	"persistence-temporarily-unavailable": 10600,
	"persistence-invalid": 10700,
	"provider-request-rejected": 10800,
	"provider-temporarily-unavailable": 10810,
	"provider-response-invalid": 10820,
	unknown: 10900,
	"patient-query-invalid": 20100,
	"patient-sync-in-progress": 20200,
	"patient-sync-stale": 20300,
	"patient-directory-snapshot-unsafe": 20400,
	"patient-directory-reference-conflict": 20500,
	"patient-binding-invalid": 20600,
	"appointment-query-invalid": 30100,
	"appointment-record-query-invalid": 30200,
	"appointment-record-patient-not-found": 30210,
	"appointment-schedule-reference-expired": 30300,
	"appointment-write-invalid": 30400,
	"appointment-write-patient-not-found": 30410,
	"appointment-hold-not-found": 30420,
	"appointment-hold-expired": 30430,
	"appointment-registration-not-found": 30440,
	"appointment-medical-payment-active": 30450,
	"appointment-source-unavailable": 30460,
	"medical-insurance-invalid": 30500,
	"medical-insurance-appointment-not-found": 30510,
	"medical-insurance-order-not-found": 30520,
	"report-query-invalid": 40100,
	"report-patient-not-found": 40110,
	"report-not-found": 40120,
	"payment-order-invalid": 50100,
	"payment-order-not-found": 50110,
	"payment-quote-not-found": 50120,
	"payment-quote-expired": 50130,
	"payment-idempotency-conflict": 50140,
	"payment-order-conflict": 50150,
	"payment-notification-rejected": 50200,
	"payment-notification-conflict": 50210,
	"payment-cash-prepay-not-allowed": 50220,
	"payment-identity-not-found": 50230,
	"payment-prepay-in-progress": 50240,
	"payment-prepay-unknown": 50250,
	"outpatient-payment-query-invalid": 50300,
	"outpatient-payment-patient-not-found": 50310,
	"health-knowledge-query-invalid": 60100,
	"health-knowledge-not-found": 60110,
	"health-knowledge-unavailable": 60120,
	"user-profile-invalid": 60200,
	"user-profile-conflict": 60210,
	"my-doctor-query-invalid": 60300,
	"my-doctor-not-found": 60310,
	"my-doctor-already-followed": 60320,
} as const);

/** 80xxx 客户端本地保留段；与服务端段位（10xxx–60xxx、10900）无交集。 */
export const CLIENT_ERROR_NUMERIC_CODES = Object.freeze({
	"api-request-failed": 80000,
	"network-failed": 80100,
	"wechat-code-missing": 80200,
	"wechat-login-failed": 80210,
	"session-missing": 80300,
	"session-changed": 80310,
	"api-base-url-missing": 80400,
	"api-base-url-insecure": 80410,
	"api-prefix-invalid": 80420,
	"app-not-initialized": 80430,
	"patient-selection-required": 80500,
	"patient-selection-stale": 80510,
	"patient-not-bound": 80520,
	"patient-clinical-unavailable": 80530,
	"appointment-department-missing": 80600,
	"date-range-invalid": 80610,
	"report-detail-id-missing": 80700,
	"report-detail-response-missing": 80710,
	"wechat-pay-params-missing": 80800,
	"wechat-payment-cancelled": 80810,
	"wechat-payment-launch-failed": 80820,
	"wechat-profile-authorization-denied": 80900,
	"wechat-profile-unavailable": 80910,
	"wechat-profile-settings-failed": 80920,
} as const);

/** 未登记原因统一回落 unknown 数字码，不猜测其他数值。 */
export const UNKNOWN_NUMERIC_CODE = 10900;

/** 数字码的保留段边界；客户端本地码必须落在 [80000, 81000)。 */
export const CLIENT_NUMERIC_CODE_RANGE = Object.freeze({
	min: 80000,
	maxExclusive: 81000,
} as const);

function lookupNumericCode(
	table: Readonly<Record<string, number | undefined>>,
	code: string,
): number | undefined {
	const value = table[code];
	return typeof value === "number" ? value : undefined;
}

/**
 * 把任意错误码解析为数字码：先查服务端镜像，再查客户端本地段，
 * 未登记的原因回落 unknown（10900）。
 */
export function resolveErrorNumericCode(code: string | undefined): number {
	if (!code) return UNKNOWN_NUMERIC_CODE;
	const serverNumeric = lookupNumericCode(
		SERVER_ERROR_NUMERIC_CODES as Readonly<Record<string, number | undefined>>,
		code,
	);
	if (serverNumeric !== undefined) return serverNumeric;
	const clientNumeric = lookupNumericCode(
		CLIENT_ERROR_NUMERIC_CODES as Readonly<Record<string, number | undefined>>,
		code,
	);
	if (clientNumeric !== undefined) return clientNumeric;
	return UNKNOWN_NUMERIC_CODE;
}

/**
 * 错误展示的"部分"目录：每个业务 surface 一个标题与兜底文案。
 *
 * 展示层用它组合"哪个部分 + 什么问题 + 怎么办"；同一原因在不同
 * surface 展示不同标题，但数字码保持不变。兜底文案沿用各页既有的
 * 中文 copy，避免用户可见文案在本轮改造中漂移。
 */
export type ClientErrorSurface =
	| "index"
	| "patient-select"
	| "appointment-directory"
	| "appointment-schedule"
	| "timeslot-source"
	| "appointment-records"
	| "missed-appointments"
	| "report-directory"
	| "report-detail"
	| "outpatient-payment"
	| "profile"
	| "my"
	| "knowledge"
	| "consult"
	| "convenience"
	| "payment";

export type ClientErrorSurfaceCopy = Readonly<{
	/** 用户可见的"哪个部分"标题。 */
	title: string;
	/** 该部分读取未完成时的兜底文案（什么问题 + 怎么办）。 */
	defaultMessage: string;
}>;

export const CLIENT_ERROR_SURFACE_COPY: Readonly<
	Record<ClientErrorSurface, ClientErrorSurfaceCopy>
> = Object.freeze({
	index: {
		title: "首页",
		defaultMessage: "当前信息暂时无法获取，请稍后重试",
	},
	"patient-select": {
		title: "就诊人",
		defaultMessage: "就诊人暂时无法获取，请稍后重试",
	},
	"appointment-directory": {
		title: "预约目录",
		defaultMessage: "预约目录暂时无法获取，请稍后重试",
	},
	"appointment-schedule": {
		title: "医生排班",
		defaultMessage: "预约信息暂时无法获取，请稍后重试",
	},
	"timeslot-source": {
		title: "号源",
		defaultMessage: "号源信息暂时无法获取，请稍后重试",
	},
	"appointment-records": {
		title: "挂号记录",
		defaultMessage: "挂号记录暂时无法获取，请稍后重试",
	},
	"missed-appointments": {
		title: "爽约记录",
		defaultMessage: "爽约记录暂时无法获取，请稍后重试",
	},
	"report-directory": {
		title: "检查报告",
		defaultMessage: "检查报告暂时无法获取，请稍后重试",
	},
	"report-detail": {
		title: "报告详情",
		defaultMessage: "报告详情暂时无法获取，请稍后重试",
	},
	"outpatient-payment": {
		title: "门诊缴费",
		defaultMessage: "缴费记录暂时无法获取，请稍后重试",
	},
	profile: {
		title: "个人资料",
		defaultMessage: "个人资料加载失败，请稍后重试",
	},
	my: {
		title: "我的",
		defaultMessage: "我的页面加载失败，请稍后重试",
	},
	knowledge: {
		title: "健康内容",
		defaultMessage: "健康内容暂时无法获取，请稍后重试",
	},
	consult: {
		title: "就诊记录",
		defaultMessage: "就诊记录暂时无法获取，请稍后重试",
	},
	convenience: {
		title: "便民服务",
		defaultMessage: "就诊人信息暂时无法获取，请稍后重试",
	},
	payment: {
		title: "支付",
		defaultMessage: "暂时无法发起支付，请稍后重试",
	},
});
