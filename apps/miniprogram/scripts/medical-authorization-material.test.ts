import { expect, test } from "bun:test";
import {
	resolveProductionMedicalAuthorizationMaterial,
	resolveTestMedicalAuthorizationMaterial,
} from "./medical-authorization-material";

const formalAppId = "synthetic-formal-application-001";
const formalCredential = "Synthetic/Formal/InstitutionCredential";

test("测试授权使用测试应用和认证码，不能回退正式材料", () => {
	const fixture = {
		environment: "test",
		paymentChannelFeedback: { appId: "synthetic-test-app" },
		identityVerificationFeedback: {
			orgChannelAuthCode: "Synthetic/Test/Credential",
		},
	};
	expect(resolveTestMedicalAuthorizationMaterial(fixture)).toEqual({
		orgAppId: "synthetic-test-app",
		orgChannelCredential: "Synthetic/Test/Credential",
	});
	expect(() =>
		resolveTestMedicalAuthorizationMaterial(productionFixture()),
	).toThrow(Error);
	expect(() => resolveProductionMedicalAuthorizationMaterial(fixture)).toThrow(
		Error,
	);
});

test("测试材料缺失时两项不可用，已有材料缺半对时拒绝", () => {
	expect(resolveTestMedicalAuthorizationMaterial(undefined)).toEqual({
		orgAppId: "",
		orgChannelCredential: "",
	});
	expect(() =>
		resolveTestMedicalAuthorizationMaterial({
			environment: "test",
			paymentChannelFeedback: { appId: "synthetic-test-app" },
			identityVerificationFeedback: {},
		}),
	).toThrow(Error);
});

function productionFixture() {
	return {
		environment: "production",
		paymentChannelFeedback: { appId: formalAppId },
		identityVerificationFeedback: {
			orgChannelAuthCode: formalCredential,
		},
	};
}

test("没有本机材料时医保授权应用与机构凭证同时保持不可用", () => {
	expect(resolveProductionMedicalAuthorizationMaterial(undefined)).toEqual({
		orgAppId: "",
		orgChannelCredential: "",
	});
});

test("正式授权应用与机构凭证必须从同一份正式材料成对读取", () => {
	expect(
		resolveProductionMedicalAuthorizationMaterial(productionFixture()),
	).toEqual({
		orgAppId: formalAppId,
		orgChannelCredential: formalCredential,
	});
});

test("机构凭证中的斜杠原样保留，不预先进行 URL 编码", () => {
	const resolved = resolveProductionMedicalAuthorizationMaterial(
		productionFixture(),
	);
	expect(resolved.orgChannelCredential).toBe(formalCredential);
	expect(resolved.orgChannelCredential).not.toContain("%2F");
});

test("只清理两个字段外围空白，保留凭证内部内容", () => {
	const fixture = productionFixture();
	fixture.paymentChannelFeedback.appId = ` \t${formalAppId}\r\n`;
	fixture.identityVerificationFeedback.orgChannelAuthCode = `\n ${formalCredential}\t `;
	expect(resolveProductionMedicalAuthorizationMaterial(fixture)).toEqual({
		orgAppId: formalAppId,
		orgChannelCredential: formalCredential,
	});
});

test("正式构建拒绝测试或未标记为正式的材料", () => {
	for (const environment of ["test", "trial", "release", "", undefined]) {
		expect(() =>
			resolveProductionMedicalAuthorizationMaterial({
				...productionFixture(),
				environment,
			}),
		).toThrow(Error);
	}
});

test("现有材料缺少授权应用或机构凭证任意一半时拒绝构建", () => {
	const fixture = productionFixture();
	for (const input of [
		{ ...fixture, paymentChannelFeedback: undefined },
		{ ...fixture, identityVerificationFeedback: undefined },
		{ ...fixture, paymentChannelFeedback: {} },
		{ ...fixture, identityVerificationFeedback: {} },
		{ ...fixture, paymentChannelFeedback: { appId: " \t " } },
		{
			...fixture,
			identityVerificationFeedback: { orgChannelAuthCode: "\r\n " },
		},
	]) {
		expect(() => resolveProductionMedicalAuthorizationMaterial(input)).toThrow(
			Error,
		);
	}
});

test("已有材料必须为结构化对象，不能把非法输入当成未配置", () => {
	for (const input of [null, false, 0, "production", [], {}]) {
		expect(() => resolveProductionMedicalAuthorizationMaterial(input)).toThrow(
			Error,
		);
	}
});

test("应用与机构凭证字段只接受非空字符串，不隐式转换类型", () => {
	for (const value of [null, undefined, false, 123, [], {}]) {
		for (const input of [
			{
				...productionFixture(),
				paymentChannelFeedback: { appId: value },
			},
			{
				...productionFixture(),
				identityVerificationFeedback: { orgChannelAuthCode: value },
			},
		]) {
			expect(() =>
				resolveProductionMedicalAuthorizationMaterial(input),
			).toThrow(Error);
		}
	}
});

test("拒绝材料的错误信息不包含应用、凭证或其他材料字段值", () => {
	const unrelatedSyntheticValue = "synthetic-private-material-do-not-print";
	const fixture = {
		...productionFixture(),
		environment: "test",
		unrelatedMaterial: unrelatedSyntheticValue,
	};
	let error: unknown;
	try {
		resolveProductionMedicalAuthorizationMaterial(fixture);
	} catch (caught) {
		error = caught;
	}
	expect(error).toBeInstanceOf(Error);
	const message = error instanceof Error ? error.message : "";
	expect(message.length).toBeGreaterThan(0);
	for (const value of [
		formalAppId,
		formalCredential,
		unrelatedSyntheticValue,
	]) {
		expect(message).not.toContain(value);
	}
});
