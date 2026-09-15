import type { LegacyFsiGateway } from "@hospital/adapters";
import type { AdapterCallContext } from "@hospital/domain";

export type AdminInsuranceQueryGateway = Pick<LegacyFsiGateway, "query1101">;

export type AdminInsuranceQueryInput = {
	mode: "identity-card" | "electronic-credential" | "social-security-card";
	identityNumber: string;
	name: string;
	credentialNumber?: string;
	cardSerialNumber?: string;
};

export class AdminInsuranceQueryInputError extends Error {
	constructor() {
		super("Admin insurance query input is invalid");
		this.name = "AdminInsuranceQueryInputError";
	}
}

function requiredText(value: unknown, maxLength: number): string {
	if (typeof value !== "string") throw new AdminInsuranceQueryInputError();
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw new AdminInsuranceQueryInputError();
	}
	return normalized;
}

function identityNumber(value: unknown): string {
	const normalized = requiredText(value, 18)
		.replaceAll(/\s/g, "")
		.toUpperCase();
	if (!/^\d{15}$|^\d{17}[0-9X]$/u.test(normalized)) {
		throw new AdminInsuranceQueryInputError();
	}
	return normalized;
}

function optionalText(value: unknown, maxLength: number): string {
	if (value === undefined || value === null || value === "") return "";
	return requiredText(value, maxLength);
}

function beijingDateTime(now = new Date()): string {
	const parts = new Intl.DateTimeFormat("zh-CN", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).formatToParts(now);
	const values = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function compactDateTime(value: string): string {
	return value.replaceAll(/[- :]/g, "");
}

function messageIdSuffix(value: string): string {
	const normalized = value.replaceAll(/[^A-Za-z0-9]/g, "").slice(0, 4);
	return normalized.padEnd(4, "0");
}

/**
 * 新 API 的 Admin 只读查询服务。
 *
 * 这里仅组装固定的 1101 通用 FSI 请求，不接受客户端的 infno、base_url、
 * path、机构号或任何加密字段。真正的 SM2/SM4、relay 和非严格验签仍由
 * LegacyFsiGateway 统一处理。
 */
export class AdminInsuranceQueryService {
	private readonly institutionCode: string;
	private readonly institutionName: string;

	constructor(options: {
		gateway: AdminInsuranceQueryGateway;
		institutionCode?: string;
		institutionName?: string;
		now?: () => Date;
		createId?: () => string;
	}) {
		this.gateway = options.gateway;
		this.institutionCode = options.institutionCode?.trim() || "H14058101270";
		this.institutionName = options.institutionName?.trim() || "高平市人民医院";
		this.now = options.now ?? (() => new Date());
		this.createId = options.createId ?? (() => crypto.randomUUID());
	}

	private readonly gateway: AdminInsuranceQueryGateway;
	private readonly now: () => Date;
	private readonly createId: () => string;

	async query(
		input: AdminInsuranceQueryInput,
		context: AdapterCallContext,
	): Promise<Record<string, unknown>> {
		if (
			input.mode !== "identity-card" &&
			input.mode !== "electronic-credential" &&
			input.mode !== "social-security-card"
		) {
			throw new AdminInsuranceQueryInputError();
		}

		const certno = identityNumber(input.identityNumber);
		const name = requiredText(input.name, 50);
		const credentialNumber =
			input.mode === "identity-card"
				? certno
				: requiredText(input.credentialNumber, 512);
		const cardSerialNumber =
			input.mode === "social-security-card"
				? requiredText(input.cardSerialNumber, 64)
				: optionalText(input.cardSerialNumber, 64);
		const mdtrtCertType =
			input.mode === "identity-card"
				? "02"
				: input.mode === "electronic-credential"
					? "01"
					: "03";
		const now = this.now();
		const infTime = beijingDateTime(now);
		const result = await this.gateway.query1101(
			{
				infno: "1101",
				// 医保通用 FSI 要求发送方报文 ID 固定 30 位：12 位机构号、14 位时间、4 位序号。
				msgid: `${this.institutionCode.slice(0, 12)}${compactDateTime(infTime)}${messageIdSuffix(this.createId())}`,
				// 管理端查询默认以医院所在的高平参保区划发起 1101；
				// 最终险种参保地仍以医保平台返回为准。
				insuplc_admdvs: "140581",
				mdtrtarea_admvs: "140581",
				dev_no: "",
				dev_safe_info: "",
				signtype: "",
				cainfo: "",
				infver: "V1.0",
				opter_type: "3",
				opter: "百灵收款员",
				opter_name: "百灵收款员",
				inf_time: infTime,
				fixmedins_code: this.institutionCode,
				fixmedins_name: this.institutionName,
				sign_no: "",
				recer_sys_code: "msun",
				input: {
					data: {
						mdtrt_cert_type: mdtrtCertType,
						mdtrt_cert_no: credentialNumber,
						card_sn: cardSerialNumber,
						begntime: infTime,
						psn_cert_type: "01",
						certno,
						psn_name: name,
					},
				},
			},
			context,
		);
		return result.data;
	}
}
