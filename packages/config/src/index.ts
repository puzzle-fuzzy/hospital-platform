export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type RuntimeConfig = {
	/** 生产环境默认关闭 OpenAPI，避免无意暴露内部接口描述。 */
	environment: "development" | "test" | "production";
	host: string;
	port: number;
	apiVersion: string;
	/** 生产默认 info；测试可设 silent，开发默认 debug。 */
	logLevel: LogLevel;
	/** 目标 schema 完成 staging 验证后才允许注入真实 repository。 */
	persistenceSchemaReady: boolean;
	docsEnabled: boolean;
	corsOrigins: string[];
	databaseUrl: string | undefined;
	redisUrl: string | undefined;
	/** 只有显式打开并提供密钥时才接入真实微信 code2session。 */
	wechatIdentityReady: boolean;
	wechatAppId: string | undefined;
	wechatAppSecret: string | undefined;
	wechatIdentityBaseUrl: string;
	/** 微信支付 APIv3 仅在完整商户配置和人工验收后打开。 */
	wechatPaymentReady: boolean;
	wechatPayAppId: string | undefined;
	wechatPayMchId: string | undefined;
	wechatPayMerchantCertificateSerial: string | undefined;
	wechatPayMerchantPrivateKey: string | undefined;
	wechatPayPlatformCertificateSerial: string | undefined;
	wechatPayPlatformPublicKey: string | undefined;
	/** 微信 APIv3 密钥只用于通知解密，不得复用数据库密文密钥。 */
	wechatPayApiV3Key: string | undefined;
	wechatPayNotifyUrl: string | undefined;
	wechatPayBaseUrl: string;
	/** 官方微信医保混合订单独立闸门；必须与普通微信支付配置同时完整。 */
	wechatMedicalInsuranceReady: boolean;
	wechatMedicalInsuranceAppId: string | undefined;
	wechatMedicalInsuranceCityId: string | undefined;
	wechatMedicalInsuranceOrderType: string | undefined;
	wechatMedicalInsuranceInstitutionName: string | undefined;
	wechatMedicalInsuranceInstitutionNo: string | undefined;
	wechatMedicalInsuranceCallbackUrl: string | undefined;
	wechatMedicalInsuranceGeoLocation: string | undefined;
	wechatMedicalInsuranceChannelNo: string | undefined;
	wechatMedicalInsuranceTestEnvironment: boolean;
	/** 旧医保 FSI 移动支付中心；完整配置不等于已通过真实结算验收。 */
	medicalInsuranceReady: boolean;
	medicalInsuranceRelayUrl: string | undefined;
	medicalInsuranceDirectBaseUrl: string | undefined;
	/** 通用 FSI（1101）明文调用的 forward 目标；与 6201/6202 目标不同。 */
	medicalInsuranceFoundationBaseUrl: string | undefined;
	medicalInsuranceRelayAuthorizationToken: string | undefined;
	medicalInsuranceAppId: string | undefined;
	medicalInsuranceAppSecret: string | undefined;
	medicalInsuranceSm2PrivateKeyB64: string | undefined;
	medicalInsuranceSm2OwnPublicKeyB64: string | undefined;
	medicalInsuranceSm2PlatformPublicKeyB64: string | undefined;
	medicalInsuranceSm2UserId: string;
	medicalInsuranceEncryptionEnabled: boolean;
	medicalInsuranceVerifyStrict: boolean;
	/** 仅用于医保 payToken 短期上下文密文，必须与微信支付密钥分离。 */
	medicalInsuranceCredentialEncryptionKey: string | undefined;
	medicalInsuranceUserQueryBaseUrl: string;
	medicalInsuranceUserQueryPath: string;
	medicalInsuranceOrgCode: string;
	medicalInsuranceHospitalId: string;
	medicalInsuranceInsutype: string;
	medicalInsuranceInsuCode: string;
	/** 众阳患者目录默认关闭；配置完整也不代表 provider 已联调。 */
	patientDirectoryReady: boolean;
	/** 预约 AMC 只读目录独立验收，不能随患者目录一起隐式打开。 */
	appointmentDirectoryReady: boolean;
	/** 预约历史使用 appointment-server 独立 endpoint，必须单独验收。 */
	appointmentRecordsReady: boolean;
	/** 预约占位、写入和取消必须独立验收，不能随只读目录开启。 */
	appointmentWritesReady: boolean;
	/** 门诊费用只读目录独立验收；支付和医保结算仍使用其他闸门。 */
	outpatientPaymentReady: boolean;
	/** 众阳 2.6.33 所需的服务端渠道标识，必须由院方/Provider 显式确认。 */
	outpatientPaymentAuthSysCode: string;
	/** 门诊病历 out-visit-records 只读接口独立验收闸门。 */
	outpatientMedicalRecordsReady: boolean;
	/** LIS/PACS/ECG 报告目录独立验收，不能随患者目录一起隐式打开。 */
	reportDirectoryReady: boolean;
	/** LIS 详情独立验收；不会因为目录 gate 打开而自动暴露 provider 资源。 */
	reportDetailReady: boolean;
	/** 众阳共享上游地址；患者、预约和报告 gate 只控制能力，不复制连接配置。 */
	zhongyangBaseUrl: string | undefined;
	/** 可选的众阳服务端 token；不能下发小程序或写入日志。 */
	zhongyangAuthorizationToken: string | undefined;
	/** 仅保护数据库中的短期支付调起参数，不是 APIv3 key。 */
	paymentDataEncryptionKey: string | undefined;
	/** worker 轮询持久化 outbox/查单计划的间隔，避免在进程内维护业务队列。 */
	workerPollIntervalMs: number;
};

/** 微信身份接口的官方默认地址；自定义地址必须由部署环境显式提供 HTTPS。 */
const DEFAULT_WECHAT_IDENTITY_BASE_URL = "https://api.weixin.qq.com";
/** 微信支付 APIv3 的官方默认地址；空白环境变量不能覆盖这个安全默认值。 */
const DEFAULT_WECHAT_PAY_BASE_URL = "https://api.mch.weixin.qq.com";

/**
 * 配置状态只描述“开关与必填字段是否齐全”，不代表 provider 沙箱或生产
 * 联调已经通过；把 configured 和真实可用性分开，避免日志给出过度承诺。
 */
export type ProviderConfigurationStatus =
	| "disabled"
	| "configured"
	| "incomplete";

/** 供启动 preflight 展示的 provider 配置诊断；missingFields 只包含环境变量名。 */
export type ProviderConfigurationDiagnostic = {
	name:
		| "wechat-identity"
		| "wechat-payment"
		| "wechat-medical-insurance"
		| "medical-insurance"
		| "zhongyang-patient-directory"
		| "zhongyang-appointment-directory"
		| "zhongyang-appointment-records"
		| "zhongyang-appointment-writes"
		| "zhongyang-outpatient-payments"
		| "zhongyang-medical-records"
		| "zhongyang-report-directory"
		| "zhongyang-report-detail";
	status: ProviderConfigurationStatus;
	missingFields: readonly string[];
};

type RequiredRuntimeField = {
	name: string;
	value: string | undefined;
};

function missingRuntimeFields(
	fields: readonly RequiredRuntimeField[],
): string[] {
	return fields.filter(({ value }) => !value).map(({ name }) => name);
}

function isHttpsUrl(value: string | undefined): boolean {
	if (!value) return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function isHttpUrl(value: string | undefined): boolean {
	if (!value) return false;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** 只返回环境变量名，绝不返回密钥、证书或 URL 的实际值。 */
export function wechatIdentityConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	if (!runtimeConfig.wechatIdentityReady) return [];
	const missing = missingRuntimeFields([
		{ name: "WECHAT_APPID", value: runtimeConfig.wechatAppId },
		{ name: "WECHAT_APP_SECRET", value: runtimeConfig.wechatAppSecret },
	]);
	if (
		runtimeConfig.wechatIdentityBaseUrl &&
		!isHttpsUrl(runtimeConfig.wechatIdentityBaseUrl) &&
		!missing.includes("WECHAT_IDENTITY_BASE_URL(https)")
	) {
		missing.push("WECHAT_IDENTITY_BASE_URL(https)");
	}
	return missing;
}

export function wechatIdentityConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.wechatIdentityReady) return "disabled";
	return wechatIdentityConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

/**
 * 微信支付 adapter 的组合根只依赖这一份字段检查；闸门打开但字段不完整
 * 时必须保持 fail-closed。通知 URL 还必须是 HTTPS，避免把 provider 回调
 * 配置成仅本机或明文 HTTP 地址。
 */
export function wechatPaymentConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	if (!runtimeConfig.wechatPaymentReady) return [];
	const missing = missingRuntimeFields([
		{ name: "WECHAT_PAY_APP_ID", value: runtimeConfig.wechatPayAppId },
		{ name: "WECHAT_PAY_MCH_ID", value: runtimeConfig.wechatPayMchId },
		{
			name: "WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL",
			value: runtimeConfig.wechatPayMerchantCertificateSerial,
		},
		{
			name: "WECHAT_PAY_MERCHANT_PRIVATE_KEY",
			value: runtimeConfig.wechatPayMerchantPrivateKey,
		},
		{
			name: "WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL",
			value: runtimeConfig.wechatPayPlatformCertificateSerial,
		},
		{
			name: "WECHAT_PAY_PLATFORM_PUBLIC_KEY",
			value: runtimeConfig.wechatPayPlatformPublicKey,
		},
		{ name: "WECHAT_PAY_API_V3_KEY", value: runtimeConfig.wechatPayApiV3Key },
		{ name: "WECHAT_PAY_NOTIFY_URL", value: runtimeConfig.wechatPayNotifyUrl },
	]);
	if (
		runtimeConfig.wechatPayNotifyUrl &&
		!isHttpsUrl(runtimeConfig.wechatPayNotifyUrl) &&
		!missing.includes("WECHAT_PAY_NOTIFY_URL")
	) {
		missing.push("WECHAT_PAY_NOTIFY_URL(https)");
	}
	if (
		runtimeConfig.wechatPayBaseUrl &&
		!isHttpsUrl(runtimeConfig.wechatPayBaseUrl) &&
		!missing.includes("WECHAT_PAY_BASE_URL(https)")
	) {
		missing.push("WECHAT_PAY_BASE_URL(https)");
	}
	return missing;
}

export function wechatPaymentConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.wechatPaymentReady) return "disabled";
	return wechatPaymentConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

/** 微信医保混合下单的字段与普通微信支付分开诊断，避免只配置 JSAPI 就误报可用。 */
export function wechatMedicalInsuranceConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	if (!runtimeConfig.wechatMedicalInsuranceReady) return [];
	const missing = missingRuntimeFields([
		{
			name: "WECHAT_MEDICAL_INSURANCE_APP_ID",
			value: runtimeConfig.wechatMedicalInsuranceAppId,
		},
		{
			name: "WECHAT_MEDICAL_INSURANCE_CITY_ID",
			value: runtimeConfig.wechatMedicalInsuranceCityId,
		},
		{
			name: "WECHAT_MEDICAL_INSURANCE_ORDER_TYPE",
			value: runtimeConfig.wechatMedicalInsuranceOrderType,
		},
		{
			name: "WECHAT_MEDICAL_INSURANCE_INSTITUTION_NAME",
			value: runtimeConfig.wechatMedicalInsuranceInstitutionName,
		},
		{
			name: "WECHAT_MEDICAL_INSURANCE_INSTITUTION_NO",
			value: runtimeConfig.wechatMedicalInsuranceInstitutionNo,
		},
		{
			name: "WECHAT_MEDICAL_INSURANCE_CALLBACK_URL",
			value: runtimeConfig.wechatMedicalInsuranceCallbackUrl,
		},
		{
			name: "WECHAT_MEDICAL_INSURANCE_GEO_LOCATION",
			value: runtimeConfig.wechatMedicalInsuranceGeoLocation,
		},
	]);
	for (const [name, value] of [
		[
			"WECHAT_MEDICAL_INSURANCE_CALLBACK_URL",
			runtimeConfig.wechatMedicalInsuranceCallbackUrl,
		],
	] as const) {
		if (value && !isHttpsUrl(value) && !missing.includes(`${name}(https)`)) {
			missing.push(`${name}(https)`);
		}
	}
	return missing;
}

export function wechatMedicalInsuranceConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.wechatMedicalInsuranceReady) return "disabled";
	return wechatMedicalInsuranceConfigurationMissingFields(runtimeConfig)
		.length === 0
		? "configured"
		: "incomplete";
}

/**
 * 医保移动支付只允许严格加密、严格验签和显式中转鉴权。
 * 旧项目曾把中转 Bearer 写死在代码里；新项目不迁移这个默认值，缺失时
 * 必须保持 incomplete，避免把正式医保报文发到未鉴权的 relay。
 */
export function medicalInsuranceConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	if (!runtimeConfig.medicalInsuranceReady) return [];
	const missing = missingRuntimeFields([
		{
			name: "MBS_FORWARD_RELAY_URL",
			value: runtimeConfig.medicalInsuranceRelayUrl,
		},
		{
			name: "MBS_FORWARD_BASE_URL_6201",
			value: runtimeConfig.medicalInsuranceDirectBaseUrl,
		},
		{
			name: "MBS_FORWARD_BASE_URL",
			value: runtimeConfig.medicalInsuranceFoundationBaseUrl,
		},
		{ name: "ZHONGYANG_BASE_URL", value: runtimeConfig.zhongyangBaseUrl },
		{
			name: "MBS_FORWARD_AUTHORIZATION_TOKEN",
			value: runtimeConfig.medicalInsuranceRelayAuthorizationToken,
		},
		{ name: "MBS_APP_ID", value: runtimeConfig.medicalInsuranceAppId },
		{ name: "MBS_APP_SECRET", value: runtimeConfig.medicalInsuranceAppSecret },
		{
			name: "MBS_SM2_PRIVATE_KEY_B64",
			value: runtimeConfig.medicalInsuranceSm2PrivateKeyB64,
		},
		{
			name: "MBS_SM2_OWN_PUBLIC_B64",
			value: runtimeConfig.medicalInsuranceSm2OwnPublicKeyB64,
		},
		{
			name: "MBS_SM2_PLATFORM_PUBLIC_B64",
			value: runtimeConfig.medicalInsuranceSm2PlatformPublicKeyB64,
		},
		{ name: "MBS_SM2_USER_ID", value: runtimeConfig.medicalInsuranceSm2UserId },
		{
			name: "MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY",
			value: runtimeConfig.medicalInsuranceCredentialEncryptionKey,
		},
	]);
	for (const [name, value, requiresHttps] of [
		["MBS_FORWARD_RELAY_URL", runtimeConfig.medicalInsuranceRelayUrl, true],
		// 这两个地址只作为 HTTPS relay 请求体中的内部路由目标；旧正式链路
		// 的医院内网 FSI/HIS 服务使用 HTTP，因此不能误判为公网明文 API。
		[
			"MBS_FORWARD_BASE_URL_6201",
			runtimeConfig.medicalInsuranceDirectBaseUrl,
			false,
		],
		[
			"MBS_FORWARD_BASE_URL",
			runtimeConfig.medicalInsuranceFoundationBaseUrl,
			false,
		],
		["ZHONGYANG_BASE_URL", runtimeConfig.zhongyangBaseUrl, true],
	] as const) {
		if (!value || missing.includes(name)) continue;
		if (!isHttpUrl(value) && !missing.includes(`${name}(url)`)) {
			missing.push(`${name}(url)`);
			continue;
		}
		if (
			requiresHttps &&
			!isHttpsUrl(value) &&
			!missing.includes(`${name}(https)`)
		) {
			missing.push(`${name}(https)`);
		}
	}
	if (!runtimeConfig.medicalInsuranceEncryptionEnabled) {
		missing.push("MBS_ENCRYPT_ENABLE");
	}
	if (!runtimeConfig.medicalInsuranceVerifyStrict) {
		missing.push("MBS_SM2_VERIFY_STRICT");
	}
	return missing;
}

export function medicalInsuranceConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.medicalInsuranceReady) return "disabled";
	return medicalInsuranceConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

/**
 * 众阳共享上游只允许从服务端配置地址；生产环境禁止明文 HTTP，避免
 * 患者/预约/报告数据在 provider 链路上裸奔。授权方式仍以 provider 合同
 * 为准，因此 token 是可选配置，不能把“有 token”误当作联调成功。
 */
export function patientDirectoryConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.patientDirectoryReady,
	);
}

function zhongyangDirectoryConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
	ready: boolean,
): string[] {
	if (!ready) return [];
	const missing = missingRuntimeFields([
		{
			name: "ZHONGYANG_BASE_URL",
			value: runtimeConfig.zhongyangBaseUrl,
		},
	]);
	if (
		runtimeConfig.zhongyangBaseUrl &&
		!isHttpsUrl(runtimeConfig.zhongyangBaseUrl) &&
		!missing.includes("ZHONGYANG_BASE_URL")
	) {
		missing.push("ZHONGYANG_BASE_URL(https)");
	}
	return missing;
}

export function patientDirectoryConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.patientDirectoryReady) return "disabled";
	return patientDirectoryConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

export function appointmentDirectoryConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.appointmentDirectoryReady,
	);
}

export function appointmentDirectoryConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.appointmentDirectoryReady) return "disabled";
	return appointmentDirectoryConfigurationMissingFields(runtimeConfig)
		.length === 0
		? "configured"
		: "incomplete";
}

export function appointmentRecordsConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.appointmentRecordsReady,
	);
}

export function appointmentRecordsConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.appointmentRecordsReady) return "disabled";
	return appointmentRecordsConfigurationMissingFields(runtimeConfig).length ===
		0
		? "configured"
		: "incomplete";
}

export function appointmentWritesConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.appointmentWritesReady,
	);
}

export function appointmentWritesConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.appointmentWritesReady) return "disabled";
	return appointmentWritesConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

export function outpatientPaymentConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	const missing = zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.outpatientPaymentReady,
	);
	// 渠道码会决定 Provider 权限和业务流量归属，不能因为环境变量缺失
	// 就使用一个看似合理的默认值；只要 gate 打开，就必须显式提供它。
	if (
		runtimeConfig.outpatientPaymentReady &&
		!runtimeConfig.outpatientPaymentAuthSysCode.trim()
	) {
		missing.push("OUTPATIENT_PAYMENT_AUTH_SYS_CODE");
	}
	return missing;
}

export function outpatientPaymentConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.outpatientPaymentReady) return "disabled";
	return outpatientPaymentConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

export function outpatientMedicalRecordsConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.outpatientMedicalRecordsReady,
	);
}

export function outpatientMedicalRecordsConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.outpatientMedicalRecordsReady) return "disabled";
	return outpatientMedicalRecordsConfigurationMissingFields(runtimeConfig)
		.length === 0
		? "configured"
		: "incomplete";
}

export function reportDirectoryConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.reportDirectoryReady,
	);
}

export function reportDirectoryConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.reportDirectoryReady) return "disabled";
	return reportDirectoryConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

export function reportDetailConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.reportDetailReady,
	);
}

export function reportDetailConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.reportDetailReady) return "disabled";
	return reportDetailConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

/**
 * 汇总所有已建配置闸门，供 API/worker preflight 复用同一套规则。
 * configured 只代表字段齐全；真实 provider 权限和联调仍必须单独验收。
 */
export function providerConfigurationDiagnostics(
	runtimeConfig: RuntimeConfig,
): readonly ProviderConfigurationDiagnostic[] {
	const entries = [
		{
			name: "wechat-identity" as const,
			status: wechatIdentityConfigurationStatus(runtimeConfig),
			missingFields: wechatIdentityConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "wechat-payment" as const,
			status: wechatPaymentConfigurationStatus(runtimeConfig),
			missingFields: wechatPaymentConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "wechat-medical-insurance" as const,
			status: wechatMedicalInsuranceConfigurationStatus(runtimeConfig),
			missingFields:
				wechatMedicalInsuranceConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "medical-insurance" as const,
			status: medicalInsuranceConfigurationStatus(runtimeConfig),
			missingFields: medicalInsuranceConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-patient-directory" as const,
			status: patientDirectoryConfigurationStatus(runtimeConfig),
			missingFields: patientDirectoryConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-appointment-directory" as const,
			status: appointmentDirectoryConfigurationStatus(runtimeConfig),
			missingFields:
				appointmentDirectoryConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-appointment-records" as const,
			status: appointmentRecordsConfigurationStatus(runtimeConfig),
			missingFields:
				appointmentRecordsConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-appointment-writes" as const,
			status: appointmentWritesConfigurationStatus(runtimeConfig),
			missingFields: appointmentWritesConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-outpatient-payments" as const,
			status: outpatientPaymentConfigurationStatus(runtimeConfig),
			missingFields: outpatientPaymentConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-medical-records" as const,
			status: outpatientMedicalRecordsConfigurationStatus(runtimeConfig),
			missingFields:
				outpatientMedicalRecordsConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-report-directory" as const,
			status: reportDirectoryConfigurationStatus(runtimeConfig),
			missingFields: reportDirectoryConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-report-detail" as const,
			status: reportDetailConfigurationStatus(runtimeConfig),
			missingFields: reportDetailConfigurationMissingFields(runtimeConfig),
		},
	] satisfies readonly ProviderConfigurationDiagnostic[];
	return entries;
}

type RuntimeEnv = Record<string, string | undefined>;

function positivePort(value: string | undefined): number {
	if (!value) return 3000;

	const port = Number(value);
	if (Number.isInteger(port) && port > 0 && port < 65_536) return port;

	throw new Error("PORT must be an integer between 1 and 65535");
}

function positiveWorkerInterval(value: string | undefined): number {
	if (!value) return 1000;

	const interval = Number(value);
	if (Number.isInteger(interval) && interval >= 100 && interval <= 60_000) {
		return interval;
	}

	throw new Error(
		"WORKER_POLL_INTERVAL_MS must be an integer between 100 and 60000",
	);
}

/** 开发环境默认只监听本机；生产容器默认监听所有容器网卡，显式 HOST 优先。 */
function host(
	value: string | undefined,
	environmentValue: RuntimeConfig["environment"],
): string {
	return (
		optional(value) ??
		(environmentValue === "production" ? "0.0.0.0" : "127.0.0.1")
	);
}

function environment(value: string | undefined): RuntimeConfig["environment"] {
	if (value === "production" || value === "test") return value;
	return "development";
}

function boolean(value: string | undefined, fallback: boolean): boolean {
	if (!value) return fallback;
	return value === "true" || value === "1";
}

function optional(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

/**
 * 解析可覆盖的上游地址。
 *
 * 环境变量经常会因为模板替换留下空字符串或首尾空格；这类值应视为“未
 * 覆盖”，回退到官方 HTTPS 地址，避免配置状态显示 configured 却把空地址
 * 注入 adapter。非空自定义地址仍交给 provider 配置闸门校验 HTTPS。
 */
function providerBaseUrl(value: string | undefined, fallback: string): string {
	return optional(value) ?? fallback;
}

function origins(value: string | undefined): string[] {
	if (!value) return ["http://localhost:5173", "http://127.0.0.1:5173"];
	return value
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

function logLevel(
	value: string | undefined,
	environmentValue: RuntimeConfig["environment"],
): LogLevel {
	if (
		value === "debug" ||
		value === "info" ||
		value === "warn" ||
		value === "error" ||
		value === "silent"
	) {
		return value;
	}
	if (environmentValue === "test") return "silent";
	return environmentValue === "production" ? "info" : "debug";
}

/**
 * 统一解析 API/worker 的运行配置。
 *
 * 传入 env 让单元测试和迁移脚本可以显式构造配置；生产入口只读取 Bun.env，
 * 不在业务模块内部散落读取环境变量，也不把密钥写进日志或 contracts。
 */
export function loadRuntimeConfig(env: RuntimeEnv): RuntimeConfig {
	const runtimeEnvironment = environment(env.NODE_ENV);
	return {
		environment: runtimeEnvironment,
		host: host(env.HOST, runtimeEnvironment),
		port: positivePort(env.PORT),
		apiVersion: env.API_VERSION ?? "0.1.0",
		logLevel: logLevel(env.LOG_LEVEL, runtimeEnvironment),
		persistenceSchemaReady: boolean(env.PERSISTENCE_SCHEMA_READY, false),
		docsEnabled: boolean(env.DOCS_ENABLED, runtimeEnvironment !== "production"),
		corsOrigins: origins(env.CORS_ORIGINS),
		databaseUrl: optional(env.DATABASE_URL),
		redisUrl: optional(env.REDIS_URL),
		wechatIdentityReady: boolean(env.WECHAT_IDENTITY_READY, false),
		wechatAppId: optional(env.WECHAT_APPID),
		wechatAppSecret: optional(env.WECHAT_APP_SECRET),
		wechatIdentityBaseUrl: providerBaseUrl(
			env.WECHAT_IDENTITY_BASE_URL,
			DEFAULT_WECHAT_IDENTITY_BASE_URL,
		),
		wechatPaymentReady: boolean(env.WECHAT_PAYMENT_READY, false),
		wechatPayAppId: optional(env.WECHAT_PAY_APP_ID),
		wechatPayMchId: optional(env.WECHAT_PAY_MCH_ID),
		wechatPayMerchantCertificateSerial: optional(
			env.WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL,
		),
		wechatPayMerchantPrivateKey: optional(env.WECHAT_PAY_MERCHANT_PRIVATE_KEY),
		wechatPayPlatformCertificateSerial: optional(
			env.WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL,
		),
		wechatPayPlatformPublicKey: optional(env.WECHAT_PAY_PLATFORM_PUBLIC_KEY),
		wechatPayApiV3Key: optional(env.WECHAT_PAY_API_V3_KEY),
		wechatPayNotifyUrl: optional(env.WECHAT_PAY_NOTIFY_URL),
		wechatPayBaseUrl: providerBaseUrl(
			env.WECHAT_PAY_BASE_URL,
			DEFAULT_WECHAT_PAY_BASE_URL,
		),
		wechatMedicalInsuranceReady: boolean(
			env.WECHAT_MEDICAL_INSURANCE_READY,
			false,
		),
		wechatMedicalInsuranceAppId: optional(env.WECHAT_MEDICAL_INSURANCE_APP_ID),
		wechatMedicalInsuranceCityId: optional(
			env.WECHAT_MEDICAL_INSURANCE_CITY_ID,
		),
		wechatMedicalInsuranceOrderType: optional(
			env.WECHAT_MEDICAL_INSURANCE_ORDER_TYPE,
		),
		wechatMedicalInsuranceInstitutionName: optional(
			env.WECHAT_MEDICAL_INSURANCE_INSTITUTION_NAME,
		),
		wechatMedicalInsuranceInstitutionNo: optional(
			env.WECHAT_MEDICAL_INSURANCE_INSTITUTION_NO,
		),
		wechatMedicalInsuranceCallbackUrl: optional(
			env.WECHAT_MEDICAL_INSURANCE_CALLBACK_URL,
		),
		wechatMedicalInsuranceGeoLocation: optional(
			env.WECHAT_MEDICAL_INSURANCE_GEO_LOCATION,
		),
		wechatMedicalInsuranceChannelNo: optional(
			env.WECHAT_MEDICAL_INSURANCE_CHANNEL_NO,
		),
		wechatMedicalInsuranceTestEnvironment: boolean(
			env.WECHAT_MEDICAL_INSURANCE_TEST_ENVIRONMENT,
			false,
		),
		medicalInsuranceReady: boolean(env.MEDICAL_INSURANCE_READY, false),
		medicalInsuranceRelayUrl: optional(env.MBS_FORWARD_RELAY_URL),
		medicalInsuranceDirectBaseUrl: optional(env.MBS_FORWARD_BASE_URL_6201),
		medicalInsuranceFoundationBaseUrl: optional(env.MBS_FORWARD_BASE_URL),
		medicalInsuranceRelayAuthorizationToken: optional(
			env.MBS_FORWARD_AUTHORIZATION_TOKEN,
		),
		medicalInsuranceAppId: optional(env.MBS_APP_ID),
		medicalInsuranceAppSecret: optional(env.MBS_APP_SECRET),
		medicalInsuranceSm2PrivateKeyB64: optional(env.MBS_SM2_PRIVATE_KEY_B64),
		medicalInsuranceSm2OwnPublicKeyB64: optional(env.MBS_SM2_OWN_PUBLIC_B64),
		medicalInsuranceSm2PlatformPublicKeyB64: optional(
			env.MBS_SM2_PLATFORM_PUBLIC_B64,
		),
		medicalInsuranceSm2UserId:
			optional(env.MBS_SM2_USER_ID) ?? "1234567812345678",
		medicalInsuranceEncryptionEnabled: boolean(env.MBS_ENCRYPT_ENABLE, true),
		medicalInsuranceVerifyStrict: boolean(env.MBS_SM2_VERIFY_STRICT, true),
		medicalInsuranceCredentialEncryptionKey: optional(
			env.MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY,
		),
		medicalInsuranceUserQueryBaseUrl: providerBaseUrl(
			env.MBS_USER_QUERY_BASE_URL,
			"https://test-receiver.wecity.qq.com",
		),
		medicalInsuranceUserQueryPath:
			optional(env.MBS_USER_QUERY_PATH) ??
			"/api/mipuserquery/userQuery/50010828",
		medicalInsuranceOrgCode:
			optional(env.MBS_INSURANCE_ORG_CODE) ?? "H14058101270",
		medicalInsuranceHospitalId: optional(env.MBS_HOSPITAL_ID) ?? "10389001",
		medicalInsuranceInsutype: optional(env.MBS_INSUTYPE) ?? "310",
		medicalInsuranceInsuCode: optional(env.MBS_INSU_CODE) ?? "140581",
		patientDirectoryReady: boolean(
			env.ZHONGYANG_PATIENT_DIRECTORY_READY,
			false,
		),
		appointmentDirectoryReady: boolean(
			env.ZHONGYANG_APPOINTMENT_DIRECTORY_READY,
			false,
		),
		appointmentRecordsReady: boolean(
			env.ZHONGYANG_APPOINTMENT_RECORDS_READY,
			false,
		),
		appointmentWritesReady: boolean(
			env.ZHONGYANG_APPOINTMENT_WRITES_READY,
			false,
		),
		outpatientPaymentReady: boolean(
			env.ZHONGYANG_OUTPATIENT_PAYMENT_READY,
			false,
		),
		// 不提供默认渠道码。旧端曾出现过 internetHospital，新旧值不能凭
		// 经验互换；缺失时让只读 gate 进入 incomplete，等待院方确认。
		outpatientPaymentAuthSysCode:
			optional(env.OUTPATIENT_PAYMENT_AUTH_SYS_CODE) ?? "",
		outpatientMedicalRecordsReady: boolean(
			env.ZHONGYANG_MEDICAL_RECORDS_READY,
			false,
		),
		reportDirectoryReady: boolean(env.ZHONGYANG_REPORT_DIRECTORY_READY, false),
		reportDetailReady: boolean(env.ZHONGYANG_REPORT_DETAIL_READY, false),
		// 兼容早期草稿变量；新部署统一使用 ZHONGYANG_BASE_URL 与
		// ZHONGYANG_AUTHORIZATION_TOKEN，避免把共享上游误命名为患者目录。
		zhongyangBaseUrl: optional(
			env.ZHONGYANG_BASE_URL ?? env.ZHONGYANG_PATIENT_DIRECTORY_BASE_URL,
		),
		zhongyangAuthorizationToken: optional(
			env.ZHONGYANG_AUTHORIZATION_TOKEN ??
				env.ZHONGYANG_PATIENT_DIRECTORY_AUTHORIZATION_TOKEN,
		),
		paymentDataEncryptionKey: optional(env.PAYMENT_DATA_ENCRYPTION_KEY),
		workerPollIntervalMs: positiveWorkerInterval(env.WORKER_POLL_INTERVAL_MS),
	};
}

/** API 和 worker 的进程入口共享这一份已解析配置。 */
export const config = loadRuntimeConfig(Bun.env);
