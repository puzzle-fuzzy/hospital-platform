import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 小程序患者可见字段审计。
 *
 * `patient.id` 是平台内部 opaque 标识，只能参与 owner/患者作用域判断，
 * 不能因为某个旧页面曾把 `patId` 叫作“ID”就继续渲染到 WXML。该工具只
 * 审计明显的可见拼接模式，不限制 data-* 事件键、storage 选择键或 API
 * 请求参数；这些仍然是业务逻辑必须使用的内部标识。
 *
 * 它不是医疗数据脱敏的唯一边界：服务端 contract、adapter 和页面运行时
 * 校验仍然必须保留。这里的价值是防止后续横向迁移新增页面时重复引入一个
 * 很容易在代码 review 中漏掉的展示回归。
 */

const repositoryRoot = new URL("../", import.meta.url);
const repositoryPath = fileURLToPath(repositoryRoot);

const VISIBLE_PATIENT_ID_RULES = Object.freeze([
	{
		name: "wxml-labelled-patient-id",
		fileKind: "wxml",
		pattern:
			/(?:患者|就诊)?ID\s*[：:]\s*\{\{[^}\n]*(?:patient|selectedPatient)(?:\?\.|\.)(?:id|patId)\b[^}\n]*\}\}/u,
	},
	{
		name: "wxml-direct-patient-id",
		fileKind: "wxml",
		pattern:
			/\{\{\s*(?:patient|selectedPatient)(?:\?\.|\.)(?:id|patId)\s*\}\}/u,
	},
	{
		name: "typescript-labelled-patient-id",
		fileKind: "typescript",
		pattern:
			/(?:患者|就诊)?ID\s*[：:][^`\n]*\$\{[^}\n]*(?:patient|selectedPatient)(?:\?\.|\.)id\b[^}\n]*\}/u,
	},
]);

function lineNumber(source, offset) {
	return source.slice(0, offset).split("\n").length;
}

function fileKindFor(relativeFile) {
	return relativeFile.endsWith(".wxml") ? "wxml" : "typescript";
}

/**
 * 审计单个页面源文件，导出给 Bun 测试使用，避免测试通过改动真实页面来
 * 验证规则。结果只返回文件位置和固定规则名，不把患者内容写进报告。
 */
export function auditPatientDisplaySource(source, relativeFile) {
	const fileKind = fileKindFor(relativeFile);
	const findings = [];
	for (const rule of VISIBLE_PATIENT_ID_RULES) {
		if (rule.fileKind !== fileKind) continue;
		for (const match of source.matchAll(
			new RegExp(rule.pattern.source, "gu"),
		)) {
			findings.push({
				file: relativeFile,
				line: lineNumber(source, match.index ?? 0),
				rule: rule.name,
			});
		}
	}
	return findings;
}

/** 只扫描页面脚本和 WXML，不扫描测试、构建产物或旧项目。 */
export async function auditMiniprogramPatientDisplay(root = repositoryPath) {
	const findings = [];
	const glob = new Bun.Glob("apps/miniprogram/src/pages/**/*.{ts,wxml}");
	let filesScanned = 0;
	for await (const relativeFile of glob.scan({ cwd: root, onlyFiles: true })) {
		if (/(?:\.test|\.spec)\.(?:ts|wxml)$/u.test(relativeFile)) continue;
		filesScanned += 1;
		const source = await Bun.file(resolve(root, relativeFile)).text();
		findings.push(...auditPatientDisplaySource(source, relativeFile));
	}
	return {
		filesScanned,
		findings,
		passed: findings.length === 0,
	};
}

if (import.meta.main) {
	const result = await auditMiniprogramPatientDisplay();
	if (!result.passed) {
		console.error(
			`小程序患者展示审计失败：发现 ${result.findings.length} 个内部 ID 可见模式`,
		);
		for (const finding of result.findings) {
			console.error(`- ${finding.file}:${finding.line} ${finding.rule}`);
		}
		process.exitCode = 1;
	} else {
		console.log(
			`小程序患者展示审计通过：扫描 ${result.filesScanned} 个页面源文件`,
		);
	}
}
