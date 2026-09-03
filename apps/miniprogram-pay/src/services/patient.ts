import { request } from "./request";

export type Patient = {
	id: string;
	displayName: string;
	relation: string;
	cardNumberMasked: string;
	clinicalAccess: "ready" | "unavailable";
};

const RELATION_LABELS: Readonly<Record<string, string>> = {
	self: "本人",
	spouse: "配偶",
	child: "子女",
	parent: "父母",
	other: "其他",
	unknown: "关系未提供",
	本人: "本人",
	配偶: "配偶",
	子女: "子女",
	父母: "父母",
	其他: "其他",
};

function relationLabel(value: unknown): string {
	const normalized = String(value ?? "").trim();
	return RELATION_LABELS[normalized] || "关系未提供";
}

function normalize(value: unknown): Patient {
	const item = value as Record<string, unknown>;
	const patient = {
		id: String(item.id || "").trim(),
		displayName: String(item.displayName || "").trim(),
		relation: relationLabel(item.relationship),
		cardNumberMasked: String(item.cardNumberMasked || "未绑定"),
		clinicalAccess: item.clinicalAccess === "ready" ? "ready" : "unavailable",
	} as Patient;
	if (!patient.id || !patient.displayName)
		throw new Error("新版平台返回的就诊人不完整");
	return patient;
}

export function mask(value: string): string {
	return value || "未绑定";
}

/** 就诊人由新版平台按当前会话返回；页面不接触医院患者号、证件号或手机号。 */
export async function loadPatients(): Promise<Patient[]> {
	const data = await request<{ items: unknown[] }>({ path: "/patients" });
	const patients = (data.items || []).map(normalize);
	if (patients.length === 0) throw new Error("当前账号未找到可用就诊人");
	if (patients.some((patient) => patient.clinicalAccess !== "ready"))
		throw new Error("当前就诊人尚未完成医院档案映射");
	return patients;
}
