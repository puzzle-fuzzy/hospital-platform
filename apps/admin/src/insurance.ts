import type {
	InsuranceRecord,
	Normalized1101Result,
	ProviderRecord,
	QueryMode,
	QueryValues,
} from "./types";

export const INSURANCE_TYPE_LABELS: Readonly<Record<string, string>> = {
	"310": "职工基本医疗保险",
	"330": "大额医疗费用补助",
	"390": "城乡居民基本医疗保险",
};

export const INSURANCE_STATUS_LABELS: Readonly<Record<string, string>> = {
	"1": "正常参保",
	"2": "暂停参保",
};

const OBJECT_WRAPPER_KEYS = ["data", "output", "body", "result"] as const;

export function isRecord(value: unknown): value is ProviderRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonString(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
		return value;
	}
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

export function records(value: unknown): ProviderRecord[] {
	const parsed = parseJsonString(value);
	if (Array.isArray(parsed)) return parsed.filter(isRecord);
	if (isRecord(parsed)) return [parsed];
	return [];
}

export function text(record: ProviderRecord, keys: readonly string[]): string {
	for (const key of keys) {
		const value = record[key];
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "bigint"
		) {
			const normalized = String(value).trim();
			if (normalized) return normalized;
		}
	}
	return "";
}

function find1101Output(value: unknown): ProviderRecord {
	const queue: unknown[] = [value];
	const visited = new Set<unknown>();
	for (let depth = 0; queue.length > 0 && depth < 24; depth += 1) {
		const candidate = parseJsonString(queue.shift());
		if (visited.has(candidate)) continue;
		visited.add(candidate);
		if (!isRecord(candidate)) continue;
		if (
			"baseinfo" in candidate ||
			"baseInfo" in candidate ||
			"insuinfo" in candidate ||
			"insuInfo" in candidate
		) {
			return candidate;
		}
		for (const key of OBJECT_WRAPPER_KEYS) {
			if (candidate[key] !== undefined) queue.push(candidate[key]);
		}
	}
	return isRecord(value) ? value : {};
}

export function normalize1101Result(value: unknown): Normalized1101Result {
	const output = find1101Output(value);
	const baseInfo = records(output.baseinfo ?? output.baseInfo)[0] ?? {};
	const insuranceInfo = records(output.insuinfo ?? output.insuInfo);
	const identityRecords = records(output.idetinfo ?? output.idetInfo);
	const insuranceRecords = insuranceInfo.map<InsuranceRecord>(
		(record, index) => {
			const psnNo = text(record, ["psn_no", "psnNo"]);
			const insuranceType = text(record, [
				"insutype",
				"insuType",
				"insutypeCode",
			]);
			return {
				key: `${psnNo || "unknown"}-${insuranceType || "unknown"}-${index}`,
				index: index + 1,
				psnNo,
				insuranceType,
				balance: text(record, ["balc", "balC", "balance"]),
				status: text(record, ["psn_insu_stas", "psnInsuStas"]),
				insuredArea: text(record, ["insuplc_admdvs", "insuplcAdmdvs"]),
				employerName: text(record, ["emp_name", "empName"]),
				personType: text(record, ["psn_type", "psnType"]),
				raw: record,
			};
		},
	);
	return { baseInfo, insuranceRecords, identityRecords, raw: value };
}

export function credentialType(mode: QueryMode): "01" | "02" | "03" {
	if (mode === "electronic-credential") return "01";
	if (mode === "social-security-card") return "03";
	return "02";
}

export function queryPayload(values: QueryValues): Record<string, string> {
	return {
		mode: values.mode,
		name: values.name.trim(),
		identityNumber: values.identityNumber.replaceAll(/\s/g, "").toUpperCase(),
		credentialNumber:
			values.mode === "identity-card"
				? values.identityNumber.replaceAll(/\s/g, "").toUpperCase()
				: String(values.credentialNumber || "").trim(),
		cardSerialNumber: String(values.cardSerialNumber || "").trim(),
		expectedPsnNo: String(values.expectedPsnNo || "").trim(),
	};
}

export function formatBalance(value: string): string {
	if (!value) return "—";
	const amount = Number(value);
	if (!Number.isFinite(amount)) return value;
	return new Intl.NumberFormat("zh-CN", {
		style: "currency",
		currency: "CNY",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);
}

export function maskIdentity(value: string): string {
	const normalized = value.replaceAll(/\s/g, "");
	if (normalized.length < 8) return normalized || "—";
	return `${normalized.slice(0, 4)}********${normalized.slice(-4)}`;
}
