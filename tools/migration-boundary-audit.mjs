import { fileURLToPath } from "node:url";

/**
 * 广度迁移边界审计。
 *
 * 旧端页面必须先全部有明确落点，但临床、患者绑定、外部会话和支付域
 * 不能为了增加“已迁移”数量而猜测 Provider 协议。这个工具把当前已经
 * 识别出的高风险页面逐一绑定到 feature-status 和固定 FeatureKey，后续
 * 若有人新增路由或把占位页改成半成品，提交门禁会立即提醒。
 *
 * 本工具只读源代码和静态配置，不访问旧服务、数据库、Redis 或 Provider。
 */

const repositoryRoot = new URL("../", import.meta.url);
const readSource = (relativePath) =>
	Bun.file(new URL(relativePath, repositoryRoot)).text();

const appConfig = JSON.parse(await readSource("apps/miniprogram/src/app.json"));
const catalog = await import(
	"../apps/miniprogram/src/services/legacy-page-catalog.ts"
);
const featureNavigation = await import(
	"../apps/miniprogram/src/services/feature-navigation.ts"
);

/**
 * 这些域的旧页面虽然已经纳入导航，但真实 contract 尚未冻结。
 * 一个域中的多个旧页面可以共享状态页，但不能共享旧端内部标识或响应。
 */
const FROZEN_DOMAIN_GATES = [
	{
		name: "门诊病历",
		featureKey: "medical-record",
		readiness: "待 provider contract",
		legacyPaths: ["pagesB/health/electronic_record.vue"],
	},
	{
		name: "住院信息",
		featureKey: "inpatient-center",
		readiness: "待 provider contract",
		legacyPaths: ["pagesB/health/inpatient_center.vue"],
	},
	{
		name: "住院支付",
		featureKey: "inpatient-payment",
		readiness: "待支付与回写 contract",
		legacyPaths: ["pagesB/health/inpatient_payment.vue"],
	},
	{
		name: "我的医生",
		featureKey: "doctor",
		readiness: "待 provider contract",
		legacyPaths: ["pagesB/patient/doctor.vue"],
	},
	{
		name: "我的问诊",
		featureKey: "consultation",
		readiness: "待外部入口 contract",
		legacyPaths: ["pagesB/user/my_consultation.vue"],
	},
	{
		name: "电子导诊单",
		featureKey: "electronic-consultation",
		readiness: "待 provider contract",
		legacyPaths: ["pagesB/health/electronic_consultation.vue"],
	},
	{
		name: "患者新增绑定",
		featureKey: "patient-binding",
		readiness: "待患者绑定 contract",
		legacyPaths: ["pagesB/patient/patientAdd.vue"],
	},
];

const expectedStatusPage = "pages/feature-status/feature-status";
const failures = [];
const gateFailureCounts = new Map();

function fail(message) {
	failures.push(message);
}

if (!appConfig.pages.includes(expectedStatusPage)) {
	fail(`app.json 未注册统一状态页：${expectedStatusPage}`);
}

for (const gate of FROZEN_DOMAIN_GATES) {
	const failureCountBeforeGate = failures.length;
	const feature = featureNavigation.FEATURE_STATUS_CATALOG[gate.featureKey];
	if (!feature) {
		fail(`${gate.name} 缺少 FeatureKey 目录项：${gate.featureKey}`);
		gateFailureCounts.set(gate.name, failures.length - failureCountBeforeGate);
		continue;
	}
	if (feature.readiness !== gate.readiness) {
		fail(
			`${gate.name} 的状态类型不一致：期望 ${gate.readiness}，实际 ${feature.readiness}`,
		);
	}

	for (const legacyPath of gate.legacyPaths) {
		const entry = catalog.LEGACY_PAGE_MIGRATION_CATALOG.find(
			(item) => item.legacyPath === legacyPath,
		);
		if (!entry) {
			fail(`${gate.name} 未登记旧页面：${legacyPath}`);
			continue;
		}
		if (entry.nativeTarget !== expectedStatusPage) {
			fail(
				`${gate.name} 的 ${legacyPath} 不应越过 contract 进入真实业务页：${entry.nativeTarget}`,
			);
		}
		if (entry.featureKey !== gate.featureKey) {
			fail(
				`${gate.name} 的 ${legacyPath} FeatureKey 不一致：期望 ${gate.featureKey}，实际 ${entry.featureKey}`,
			);
		}
	}
	gateFailureCounts.set(gate.name, failures.length - failureCountBeforeGate);
}

/**
 * 这里重复声明最容易被误带回小程序的内部字段，作为广度迁移的最后一道
 * 防线。详细实现边界仍由 architecture:audit 负责，本工具只关注冻结域。
 */
const miniprogramGlob = new Bun.Glob(
	"apps/miniprogram/src/**/*.{ts,js,wxml,wxss,json,jsonc}",
);
for await (const file of miniprogramGlob.scan({
	cwd: fileURLToPath(repositoryRoot),
	onlyFiles: true,
})) {
	if (/(?:\.test|\.spec)\.(?:ts|js)$/u.test(file)) continue;
	const source = await Bun.file(
		new URL(file.replaceAll("\\", "/"), repositoryRoot),
	).text();
	for (const forbidden of [
		"patId",
		"patInHosId",
		"thirdPatientId",
		"out-visit-record-id",
	]) {
		if (source.includes(forbidden)) {
			fail(`小程序生产文件 ${file} 仍包含冻结内部字段：${forbidden}`);
		}
	}
}

for (const gate of FROZEN_DOMAIN_GATES) {
	const failureCount = gateFailureCounts.get(gate.name) ?? 1;
	console.log(
		`[${failureCount === 0 ? "PASS" : "FAIL"}] ${gate.name}：${gate.legacyPaths.length} 个旧入口 -> ${expectedStatusPage}?feature=${gate.featureKey}（${gate.readiness}）`,
	);
}

if (failures.length > 0) {
	console.error(`Migration boundary audit failed: ${failures.length} rule(s)`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log(
		`Migration boundary audit passed: ${FROZEN_DOMAIN_GATES.length} frozen domain gate(s)`,
	);
}
