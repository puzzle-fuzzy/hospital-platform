import { expect, test } from "bun:test";
import {
	InpatientEpisodeResultValidationError,
	normalizeInpatientEpisodes,
} from "./inpatient";
import type { InpatientEpisode } from "./inpatient";

const episode: InpatientEpisode = {
	patientName: "张三",
	inpatientNumber: "ZY-001",
	cardNumberMasked: "A***1234",
	sex: "男",
	age: "42岁",
	admittedAt: "2026-08-28 09:30:00",
	status: "inpatient",
	bedStatus: "in_bed",
	primaryDoctorName: "主治医生",
	diagnoses: [{ name: "胸痛", isPrimary: true }],
	babies: [
		{
			name: "张小三",
			heightCm: 48.5,
			weightKg: 3.2,
		},
	],
};

test("住院 episode 只保留白名单字段并保留合法空缺字段", () => {
	const result = normalizeInpatientEpisodes([
		{
			...episode,
			providerPatientId: "must-not-leak",
			rawCardNo: "must-not-leak",
		},
	]);

	expect(result).toEqual([episode]);
	expect(JSON.stringify(result)).not.toContain("providerPatientId");
	expect(JSON.stringify(result)).not.toContain("rawCardNo");
});

test("住院 episode 拒绝未知状态、未遮罩卡号和重复记录", () => {
	for (const invalid of [
		{ ...episode, status: "unknown" },
		{ ...episode, cardNumberMasked: "12345678" },
		[episode, episode],
	]) {
		expect(() => normalizeInpatientEpisodes(invalid)).toThrowError(
			InpatientEpisodeResultValidationError,
		);
	}
});
