import { describe, expect, test } from "bun:test";
import {
	REQUIRED_SAMPLE_KINDS,
	validateClinicalContractPacket,
} from "./clinical-contract-packet-audit.mjs";

function validPacket() {
	return {
		schemaVersion: 1,
		domainId: "outpatient-records",
		contractStatus: "pending",
		source: {
			documentId: "provider-contract-20260825",
			sha256: "a".repeat(64),
			version: "v1",
			environment: "staging",
		},
		samples: [],
		ownerMapping: {
			clientInput: "platform-patient-id",
			providerIdentity: "server-only",
			serverMappingEvidenceRef: "evidence/owner-mapping",
		},
		fieldAllowlist: [
			{
				name: "visitTime",
				publicExposure: "public",
				publicType: "iso-datetime",
				nullable: false,
				sourceRef: "success-non-empty.visitTime",
			},
		],
		redactionRule: {
			response: "只返回固定摘要字段",
			logs: "不记录姓名、证件、卡号和原始报文",
			storage: "不保存 provider 原始响应",
		},
		errorMapping: [
			{
				kind: "provider-rejected",
				publicCode: "provider-rejected",
				retryable: false,
				evidenceRef: "rejected",
			},
			{
				kind: "timeout",
				publicCode: "dependency-temporarily-unavailable",
				retryable: true,
				evidenceRef: "timeout",
			},
		],
		acceptanceGates: {
			ownerIsolation: "pending",
			wrongPatient: "pending",
			unknownProviderState: "pending",
			traceLink: "pending",
			logRedaction: "pending",
		},
		nextAction: "等待正式 Provider contract 和脱敏材料确认",
	};
}

function buildPacket() {
	const packet = validPacket();
	packet.samples = REQUIRED_SAMPLE_KINDS.map((kind) => ({
		kind,
		documentId: `sample-${kind}`,
		sha256: "b".repeat(64),
		payloadLocation: `secure-store/clinical/${kind}`,
	}));
	return packet;
}

describe("临床 contract 材料包审计", () => {
	test("完整材料包只输出聚合摘要，并保持业务未就绪", () => {
		const report = validateClinicalContractPacket(buildPacket());

		expect(report).toMatchObject({
			valid: true,
			domainId: "outpatient-records",
			contractStatus: "pending",
			businessReady: false,
			fieldCount: 1,
		});
		expect(report.sampleKinds).toEqual(REQUIRED_SAMPLE_KINDS);
	});

	test("缺少样例或把原始内容写进材料包时拒绝", () => {
		const missingSample = buildPacket();
		missingSample.samples = missingSample.samples.filter(
			(sample) => sample.kind !== "timeout",
		);
		expect(() => validateClinicalContractPacket(missingSample)).toThrow(
			"missing sample kind: timeout",
		);

		const inlinePayload = buildPacket();
		inlinePayload.samples[0].payload = { patId: "must-not-be-stored" };
		expect(() => validateClinicalContractPacket(inlinePayload)).toThrow(
			"unknown field",
		);
	});

	test("客户端 owner 输入和 Provider 身份边界不能被放宽", () => {
		const packet = buildPacket();
		packet.ownerMapping.clientInput = "patId";
		expect(() => validateClinicalContractPacket(packet)).toThrow(
			"must be platform-patient-id",
		);

		const unknownDomain = buildPacket();
		unknownDomain.domainId = "payment";
		expect(() => validateClinicalContractPacket(unknownDomain)).toThrow(
			"unknown clinical domain",
		);
	});
});
