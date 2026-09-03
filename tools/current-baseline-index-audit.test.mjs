import { expect, test } from "bun:test";
import {
	auditCurrentBaselineIndex,
	validateCurrentBaselineIndex,
} from "./current-baseline-index-audit.mjs";

const validIndex = {
	schemaVersion: 1,
	updatedAt: "2026-08-31",
	server: {
		release: "5738a71e0bcddaa8849106754baf5b296427bed7",
		service: "hospital-platform-api-v2.service",
		publicBaseUrl: "https://test-hp.meiyi.pro/api/v2",
	},
	miniProgram: {
		commit: "9354104",
		sourceRevision: "935410473e5a7c1be125a85834f957f53a833d8f",
		liveBuildInfo: "apps/miniprogram/dist/build-info.json",
		pageCount: 38,
	},
	persistence: {
		schemaHead: "0017_outbox_manual_review_state",
		migrationSource: "packages/persistence/src/migrate.ts",
	},
	realDeviceEvidence: {
		manifest:
			"docs/发布/真机证据-935410473e5a7c1be125a85834f957f53a833d8f-pending.json",
		status: "pending",
	},
};

test("当前基线索引通过结构校验", () => {
	expect(validateCurrentBaselineIndex(validIndex)).toEqual([]);
});

test("当前基线索引拒绝不匹配的候选、真机清单和 live 来源", () => {
	const result = auditCurrentBaselineIndex(validIndex, {
		candidateDocument: [
			"| 服务端 release | `5738a71e0bcddaa8849106754baf5b296427bed7` |",
			"| 小程序客户端 | `9354104` |",
			"| 小程序构建来源 | `935410473e5a7c1be125a85834f957f53a833d8e` |",
		].join("\n"),
		evidenceManifest: {
			candidate: {
				serverRelease: validIndex.server.release,
				miniProgramCommit: validIndex.miniProgram.commit,
				sourceRevision: validIndex.miniProgram.sourceRevision,
			},
		},
		activeMiniProgramSourceRevision: "old-source-revision",
		migrationSource: 'id: "0001_core"',
	});

	expect(result.passed).toBe(false);
	expect(result.failures).toEqual([
		"候选文档小程序 sourceRevision 与当前基线索引不一致",
		"live build-info.json sourceRevision 与当前基线索引不一致",
		"持久化 migration 源码未包含当前 schema head",
	]);
});

test("当前基线索引要求 sourceRevision 以小程序提交开头", () => {
	const failures = validateCurrentBaselineIndex({
		...validIndex,
		miniProgram: {
			...validIndex.miniProgram,
			sourceRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
	});

	expect(failures).toContain(
		"当前基线索引 miniProgram.sourceRevision 不是 commit 的前缀",
	);
});
