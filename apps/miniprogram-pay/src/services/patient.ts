import { asList, asRecord, providerRequest } from "./request";
import { assertProviderSession } from "./session";

export type Patient = {
	patId: string;
	name: string;
	cardNo: string;
	idNo: string;
	phone: string;
	relation: string;
};

function firstText(record: Record<string, any>, keys: string[]): string {
	for (const key of keys) {
		const value = String(record[key] ?? "").trim();
		if (value) return value;
	}
	return "";
}

export function mask(value: string): string {
	if (value.length <= 4) return value;
	return `${value.slice(0, 3)}****${value.slice(-2)}`;
}

/** 先按 unionId 取绑定就诊人，再补查众阳 patId。 */
export async function loadPatients(): Promise<Patient[]> {
	const session = await assertProviderSession();
	const bindingResponse = await providerRequest<unknown>({
		path: "/api/public/patientInfoByUnionId",
		query: { unionId: session.unionid },
	});
	const bindingList = asList<Record<string, any>>(bindingResponse);
	const bindings =
		bindingList.length > 0
			? bindingList
			: [asRecord(bindingResponse)].filter(
					(item) => item.patientName || item.patName || item.name,
				);
	if (bindings.length === 0) throw new Error("当前微信未绑定就诊人");

	const patients: Patient[] = [];
	for (const binding of bindings) {
		const cardNo = firstText(binding, ["cardNo", "card_no", "medicalCardNo"]);
		const name = firstText(binding, ["patientName", "patName", "name"]);
		if (!cardNo || !name) continue;
		const archiveResponse = await providerRequest<unknown>({
			path: "/msun-middle-aggregate-patient/v1/patInfosFind",
			query: { type: 3, cardNo, patName: name },
		});
		const archive =
			asList<Record<string, any>>(archiveResponse)[0] ||
			asRecord(archiveResponse);
		const patId = firstText(archive, ["patId", "id"]);
		if (!patId) continue;
		patients.push({
			patId,
			name,
			cardNo,
			idNo:
				firstText(archive, ["idCardNo", "idcardNo", "idNo", "certNo"]) ||
				firstText(binding, ["idCardNo", "idcardNo"]),
			phone: firstText(binding, ["mobile", "telephone", "phone"]),
			relation: firstText(binding, ["relation"]) || "本人",
		});
	}
	if (patients.length === 0)
		throw new Error("就诊人已绑定，但未找到医院 patId");
	return patients;
}
