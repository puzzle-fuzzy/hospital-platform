import { request, asRecord } from "./request";

export type OutpatientRecord = {
	recordId: string;
	status: "unpaid" | "paid";
	departmentName?: string;
	doctorName?: string;
	billDate: string;
	amountFen: number;
};

function normalize(value: unknown): OutpatientRecord {
	const item = asRecord(value);
	const status: OutpatientRecord["status"] =
		item.status === "paid" ? "paid" : "unpaid";
	const amountFen = Number(item.amountFen);
	const departmentName = String(item.departmentName || "").trim();
	const doctorName = String(item.doctorName || "").trim();
	const record: OutpatientRecord = {
		recordId: String(item.recordId || "").trim(),
		status,
		billDate: String(item.billDate || "").trim(),
		amountFen,
	};
	if (departmentName) record.departmentName = departmentName;
	if (doctorName) record.doctorName = doctorName;
	if (
		!record.recordId ||
		!record.billDate ||
		!Number.isInteger(amountFen) ||
		amountFen < 0
	)
		throw new Error("服务端返回的门诊费用信息不完整");
	return record;
}

/** 真实接入的当前范围：只查询新版平台已经开放的 2.6.33 待缴目录。 */
export async function loadUnpaidRecords(
	patientId: string,
): Promise<OutpatientRecord[]> {
	const data = await request<{
		status: "unpaid" | "paid";
		items: unknown[];
		total: number;
	}>({
		path: "/payments/outpatient/records",
		query: { patientId, status: "unpaid" },
	});
	if (data.status !== "unpaid") throw new Error("服务端未返回待缴费目录");
	return (data.items || []).map(normalize);
}

export function amountYuan(amountFen: number): string {
	return (amountFen / 100).toFixed(2);
}
