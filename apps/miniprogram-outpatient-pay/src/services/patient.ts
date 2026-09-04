import { request, asRecord } from "./request";

export type Patient = {
	id: string;
	displayName: string;
	relation: string;
	cardNumberMasked: string;
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
	const item = asRecord(value);
	const patient = {
		id: String(item.id || "").trim(),
		displayName: String(item.displayName || "").trim(),
		relation: relationLabel(item.relationship),
		cardNumberMasked: String(item.cardNumberMasked || "未绑定"),
	};
	if (!patient.id || !patient.displayName)
		throw new Error("新版平台返回的就诊人不完整");
	return patient;
}

export async function loadPatients(): Promise<Patient[]> {
	const data = await request<{ items: unknown[] }>({ path: "/patients" });
	const patients = (data.items || []).map(normalize);
	if (patients.length === 0) throw new Error("当前账号未找到可用就诊人");
	return patients;
}
