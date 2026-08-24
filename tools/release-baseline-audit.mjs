import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

/**
 * 服务端 release 的运行时代码范围。
 *
 * 文档、测试和小程序可以在 release 之后继续完善；但这些目录中的运行时
 * 代码一旦变化，线上 `002acc1` 仍然运行旧实现，本地测试却可能已经验证了
 * 新实现。发布基线必须把这种“本地正确、线上过期”的状态直接拦住。
 */
export const serverRuntimeSourceRoots = Object.freeze([
	"apps/api/src",
	"packages/adapters/src",
	"packages/config/src",
	"packages/contracts/src",
	"packages/domain/src",
	"packages/observability/src",
	"packages/persistence/src",
]);

function isRuntimeSourcePath(path) {
	const normalized = path.replaceAll("\\", "/");
	if (
		!serverRuntimeSourceRoots.some((root) => normalized.startsWith(`${root}/`))
	) {
		return false;
	}
	// 测试和 fixture 不会被生产组合根装载；它们可以随文档门禁单独更新。
	if (normalized.includes("/fixtures/") || normalized.includes("/__tests__/")) {
		return false;
	}
	return !/(^|\/)[^/]+\.(?:test|spec)\.[^/]+$/u.test(normalized);
}

function runGit(rootDirectory, args) {
	return execFileSync("git", args, {
		cwd: rootDirectory,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function sourceAtRevision(revision, path, git = runGit) {
	try {
		return git(["show", `${revision}:${path}`]);
	} catch {
		// 文件新增或删除都属于运行时代码漂移，不能用“读不到旧文件”掩盖。
		return undefined;
	}
}

/**
 * 只比较会进入 JavaScript 运行时的内容。
 *
 * TypeScript 的类型和注释不会进入 Bun 运行包，因此中文注释、类型擦除后
 * 的差异不应强迫线上为文档性改动重启；真正的语句、常量和导入变化仍会在
 * transpile 后保留下来并触发 release 漂移失败。这个判断只服务于发布门，
 * 不替代 `tsc`、Biome 或业务测试。
 */
function runtimeComparableSource(path, source) {
	if (source === undefined) return undefined;
	if (!/\.(?:ts|tsx)$/u.test(path)) return source;
	const loader = path.endsWith(".tsx") ? "tsx" : "ts";
	return new Bun.Transpiler({ loader }).transformSync(source).trim();
}

/**
 * 比较 release 后的服务端文件；单独导出纯比较逻辑，避免测试依赖真实 Git
 * 仓库，也让失败输出只包含文件路径，不回显源码、token 或配置。
 */
export function auditServerRuntimeSourceChanges(
	baseline,
	changedFiles,
	readSource,
) {
	const changedRuntimeFiles = [];
	for (const path of changedFiles) {
		if (!isRuntimeSourcePath(path)) continue;
		const before = runtimeComparableSource(
			path,
			readSource(baseline.serverRelease, path),
		);
		const after = runtimeComparableSource(path, readSource("HEAD", path));
		if (before === undefined || after === undefined || before !== after) {
			changedRuntimeFiles.push(path);
		}
	}
	return changedRuntimeFiles;
}

/**
 * 审计当前服务端 release 之后是否出现未部署的运行逻辑变化。
 *
 * 只读业务验收必须绑定线上正在运行的服务端版本；如果 release 不是当前
 * 工作树祖先，或 release 之后出现运行时代码差异，调用方必须先生成新的
 * release 并完成共存发布，再继续使用真机二维码取证。
 */
export function auditServerSourceRelease(baseline, options = {}) {
	const rootDirectory = options.rootDirectory ?? repositoryRoot;
	const git = options.runGit ?? ((args) => runGit(rootDirectory, args));
	const failures = [];
	let changedFiles = [];
	try {
		git(["merge-base", "--is-ancestor", baseline.serverRelease, "HEAD"]);
		changedFiles = git([
			"diff",
			"--name-only",
			"--diff-filter=ACMRTUXB",
			`${baseline.serverRelease}..HEAD`,
			"--",
			...serverRuntimeSourceRoots,
		])
			.split(/\r?\n/u)
			.map((path) => path.trim())
			.filter(Boolean);
	} catch {
		return {
			passed: false,
			changedRuntimeFiles: [],
			failures: [
				`当前服务端 release ${baseline.serverRelease} 不是工作树可验证的祖先，不能确认线上与本地代码关系`,
			],
		};
	}

	const readSource = (revision, path) => sourceAtRevision(revision, path, git);
	const changedRuntimeFiles = auditServerRuntimeSourceChanges(
		baseline,
		changedFiles,
		readSource,
	);
	if (changedRuntimeFiles.length > 0) {
		failures.push(
			`服务端 release ${baseline.serverRelease} 之后存在未部署运行时代码：${changedRuntimeFiles.join(", ")}`,
		);
	}
	return {
		passed: failures.length === 0,
		changedRuntimeFiles,
		failures,
	};
}

/**
 * 当前真机候选必须只有一个人工入口。
 *
 * 历史候选文档仍然保留，用于追溯当时的运行包和验收窗口；这里不能继续
 * 硬编码已经过期的候选，否则发布基线审计即使通过，也可能把旧二维码对应的
 * 运行包当成当前包。每次构建来源发生变化时，应同时新增当前候选记录并更新
 * 这个入口，避免“代码已推进、验收文档仍指向旧包”的隐性漂移。
 */
const currentCandidateDocumentPath =
	"docs/release/candidate-4ba492a-local-build-2026-08-22.md";

/**
 * 当前候选文档是发布基线的唯一人工入口；只有明确标记为当前入口的少量文档
 * 才需要引用同一服务端 release 和小程序来源指纹。历史发布记录可以保留旧
 * hash，不能因为它们曾经写过“当前”就被重新解释成这次真机验收版本。
 */
export const currentBaselineDocuments = Object.freeze([
	{ path: "docs/README.md", label: "文档导航" },
	{ path: "docs/wechat-auth-login.md", label: "微信授权登录手册" },
	{
		path: currentCandidateDocumentPath,
		label: "当前小程序本地构建候选",
	},
	{
		path: "docs/release/6db3217b-production-acceptance-2026-08-24.md",
		label: "当前服务端生产切换记录",
	},
	// 当前业务执行板、只读链路审计和真机模板也属于人工验收入口；如果不纳入
	// 同一基线集合，文档虽然能打开，执行人员仍可能从旧模板生成可通过格式审计
	// 的二维码证据。历史候选文档不加入这里，继续只承担追溯职责。
	{
		path: "docs/release/next-business-gates-2026-08-20.md",
		label: "下一阶段业务门禁执行板",
	},
	{
		path: "docs/release/readonly-business-chain-audit-2026-08-21.md",
		label: "当前只读业务链审计",
	},
	{
		path: "docs/release/current-gated-domains-audit-2026-08-21.md",
		label: "当前未开放业务门禁审计",
	},
	{
		path: "docs/release/readonly-business-invariant-review-2026-08-22.md",
		label: "当前只读业务不变量审计",
	},
	{
		path: "docs/release/current-device-acceptance-gate-2026-08-22.md",
		label: "当前真机准入记录",
	},
	// 当前下一步审计和最新二维码会话是人工操作的直接入口；把它们纳入
	// 发布基线后，服务端或小程序候选变化时，旧二维码交接记录会立即被门禁
	// 拦住，避免下一次会话沿用已经失效的运行包和二维码。
	{
		path: "docs/release/current-next-step-audit-2026-08-22.md",
		label: "当前候选下一步审计",
	},
	{
		path: "docs/release/appointment-record-status-mapping-audit-2026-08-22.md",
		label: "当前预约历史状态映射审计",
	},
	{
		path: "docs/release/current-public-health-observation-2026-08-22-1811.md",
		label: "当前公网健康探针观察",
	},
	{
		path: "docs/release/miniprogram-real-device-evidence-template-7f09bbb.md",
		label: "当前小程序真机证据模板",
	},
	{ path: "docs/roadmap-next-phase.md", label: "下一阶段实施路线图" },
	{
		path: "docs/migration/remaining-migration-inventory.md",
		label: "剩余迁移清单",
	},
	{
		path: "docs/release/miniprogram-real-device-acceptance-checklist-2026-08-19.md",
		label: "当前小程序真机验收清单",
	},
	{
		path: "docs/release/p0-readonly-business-acceptance-runbook-2026-08-17.md",
		label: "P0 只读业务验收手册",
	},
	{
		path: "docs/release/readonly-business-contract-audit-2026-08-18.md",
		label: "P0 只读业务 contract 审计",
	},
	{
		path: "docs/migration/migration-gap-audit-2026-08-17.md",
		label: "迁移差距审计",
	},
	{
		path: "docs/release/report-readonly-contract-audit-2026-08-18.md",
		label: "报告只读契约审计",
	},
	// 这些业务审计/验收协议会被新会话直接用于准备真机操作；它们虽然不是
	// 发布切换记录，但一旦继续引用旧的服务端或小程序来源，就会把有效的
	// 页面证据绑定到错误的运行包，因此必须纳入同一套当前基线检查。
	{
		path: "docs/release/current-profile-read-write-acceptance-2026-08-22.md",
		label: "普通资料当前读写验收协议",
	},
	{
		path: "docs/release/next-appointment-records-acceptance-2026-08-22.md",
		label: "预约历史与爽约验收清单",
	},
	{
		path: "docs/release/outpatient-payment-readonly-audit-2026-08-22.md",
		label: "门诊费用只读审计",
	},
	{
		path: "docs/release/report-readonly-current-candidate-audit-2026-08-22.md",
		label: "报告只读当前候选审计",
	},
	{
		path: "docs/release/readonly-profile-patient-state-audit-2026-08-21.md",
		label: "普通资料与患者状态机审计",
	},
	{
		path: "docs/release/patient-directory-correctness-audit-2026-08-21.md",
		label: "患者目录正确性审计",
	},
	{
		path: "docs/release/miniprogram-typescript-runtime-audit-2026-08-22.md",
		label: "小程序 TypeScript 运行包审计",
	},
	{
		path: "docs/release/my-page-migration-audit-2026-08-22.md",
		label: "我的页面迁移审计",
	},
	{
		path: "docs/release/miniprogram-profile-logic-audit-2026-08-20.md",
		label: "小程序资料逻辑审计",
	},
	{
		path: "docs/release/profile-read-model-display-fail-closed-2026-08-22.md",
		label: "资料读模型 fail-closed 审计",
	},
	{
		path: "docs/release/miniprogram-readonly-list-load-more-boundary-audit-2026-08-21.md",
		label: "小程序只读列表窗口审计",
	},
]);

/**
 * 当前基线文档中容易被历史发布记录污染的“当前候选”短语。
 *
 * 仅检查文档包含完整 sourceRevision 不够：同一文件可能在顶部写对当前候选，
 * 正文却仍把旧候选写成“当前配套包”，导致验收人员导入错误运行包。这里逐个
 * 检查所有匹配短语附近的完整来源，历史段落不使用这些当前语义短语即可保留。
 */
const currentCandidateReferenceRules = Object.freeze([
	{
		path: "docs/README.md",
		label: "文档导航",
		sections: [
			{
				start: "# 项目文档导航",
				end: "## 发布与运行",
				phrases: [{ text: "因早于当前", expected: "short" }],
			},
		],
	},
	{
		path: "docs/release/readonly-business-contract-audit-2026-08-18.md",
		label: "P0 只读业务 contract 审计",
		sections: [
			{
				start: "## 1. 证据范围与当前发布边界",
				end: "## 2. 已验证的不变量",
				phrases: [{ text: "当前配套候选为", expected: "full" }],
			},
			{
				start: "## 3. 当前工作树测试证据",
				end: "## 4. 尚未完成的证据与停止条件",
				phrases: [{ text: "当前真机候选以", expected: "short" }],
			},
		],
	},
	{
		path: "docs/migration/migration-gap-audit-2026-08-17.md",
		label: "迁移差距审计",
		sections: [
			{
				start: "## 2. 当前事实",
				end: "## 3.",
				phrases: [{ text: "配套小程序构建来源为", expected: "full" }],
			},
		],
	},
	{
		path: "docs/release/report-readonly-contract-audit-2026-08-18.md",
		label: "报告只读契约审计",
		sections: [
			{
				start: "## 0. 当前检查点",
				end: "## 1. 当前链路",
				phrases: [{ text: "配套小程序构建来源为", expected: "full" }],
			},
			{
				start: "## 1. 当前链路",
				end: "## 2.",
				phrases: [{ text: "配套小程序构建来源为", expected: "full" }],
			},
		],
	},
	{
		path: "docs/release/next-business-gates-2026-08-20.md",
		label: "下一阶段业务门禁执行板",
		sections: [
			{
				start: "## 2026-08-21 当前候选只读业务复核",
				end: "## 1. 当前门禁状态",
				phrases: [
					{
						text: "当前验收基线为服务端",
						expected: "short",
						serverExpected: "full",
					},
				],
			},
		],
	},
	{
		path: "docs/release/readonly-business-invariant-review-2026-08-22.md",
		label: "当前只读业务不变量审计",
		sections: [
			{
				start: "## 1. 当前版本与运行边界",
				end: "## 2. 业务不变量审计结论",
				phrases: [{ text: "小程序运行包来源：", expected: "full" }],
			},
			{
				start: "## 3. 本轮验证证据",
				end: "### 2026-08-22 继续复核",
				phrases: [
					{
						text: "发布基线指向服务端",
						expected: "short",
						serverExpected: "full",
					},
				],
			},
			{
				start: "## 5. 下一步准入顺序",
				end: "开发者工具若",
				phrases: [{ text: "来源为", expected: "full" }],
			},
		],
	},
	{
		path: "docs/migration/remaining-migration-inventory.md",
		label: "剩余迁移清单",
		sections: [
			{
				start: "## 2026-08-22 当前执行决策",
				end: "## 历史记录（仅供追溯）",
				phrases: [
					{ text: "当前进行中：", expected: "short" },
					{ text: "小程序运行包来源为", expected: "full" },
				],
			},
		],
	},
]);

/** 从验收候选的表格中提取当前服务端和小程序来源指纹。 */
export function extractCurrentBaseline(candidateDocument) {
	const serverRelease = candidateDocument.match(
		/^\| 服务端 release \| `([0-9a-f]{7,40})` \|/mu,
	)?.[1];
	const miniProgramCommit = candidateDocument.match(
		/^\| 小程序客户端 \| `([0-9a-f]{7,40})` \|/mu,
	)?.[1];
	const miniProgramSourceRevision = candidateDocument.match(
		/^\| 小程序构建来源 \| `([0-9a-f]{40})` \|/mu,
	)?.[1];

	if (!serverRelease || !miniProgramCommit || !miniProgramSourceRevision) {
		throw new Error(
			"当前候选文档缺少可解析的服务端 release、小程序提交或完整 sourceRevision",
		);
	}
	if (!miniProgramSourceRevision.startsWith(miniProgramCommit)) {
		throw new Error("小程序 sourceRevision 不是候选文档声明的小程序提交前缀");
	}

	return { serverRelease, miniProgramCommit, miniProgramSourceRevision };
}

/**
 * 从路线图中提取“当前立即执行项”正文。
 *
 * 路线图同时保留了大量历史发布记录；如果只用全文搜索当前 hash，旧
 * release 也可能让审计通过，下一次真机验收就有拿错运行包的风险。当前
 * 执行项必须和历史追溯段有明确标题边界，不能让历史文字混入当前指令。
 */
export function extractCurrentExecutionSection(roadmapDocument) {
	const currentHeader = "## 本次立即执行项";
	const historyHeader = "### 历史补充（仅供追溯，不作为当前执行项）";
	const currentStart = roadmapDocument.indexOf(currentHeader);
	if (currentStart < 0) return undefined;
	const sectionStart = currentStart + currentHeader.length;
	const historyStart = roadmapDocument.indexOf(historyHeader, sectionStart);
	if (historyStart < 0) return undefined;
	return roadmapDocument.slice(sectionStart, historyStart);
}

/**
 * 当前路线图的执行指令必须锁定同一套候选来源。
 * 只返回固定的文档错误，不回显 token、患者信息或 Provider 原文。
 */
export function auditCurrentExecutionSection(baseline, roadmapDocument) {
	const section = extractCurrentExecutionSection(roadmapDocument);
	if (!section) {
		return ["下一阶段实施路线图缺少当前执行项与历史追溯段的明确边界"];
	}

	const failures = [];
	if (!section.includes(baseline.serverRelease)) {
		failures.push(`当前执行项缺少当前服务端 release ${baseline.serverRelease}`);
	}
	if (!section.includes(baseline.miniProgramCommit)) {
		failures.push(`当前执行项缺少小程序提交 ${baseline.miniProgramCommit}`);
	}
	if (!section.includes(baseline.miniProgramSourceRevision)) {
		failures.push(
			`当前执行项缺少完整小程序 sourceRevision ${baseline.miniProgramSourceRevision}`,
		);
	}
	return failures;
}

/** 检查当前语义短语附近的候选来源，避免旧 hash 伪装成当前运行包。 */
export function auditCurrentCandidateReferences(baseline, documents) {
	const failures = [];
	for (const rule of currentCandidateReferenceRules) {
		const document = documents.find((item) => item.path === rule.path);
		if (!document) {
			continue;
		}
		for (const section of rule.sections) {
			const sectionStart = document.content.indexOf(section.start);
			const sectionEnd = document.content.indexOf(
				section.end,
				sectionStart + 1,
			);
			if (sectionStart < 0 || sectionEnd < 0) {
				failures.push(`${rule.label} 缺少候选审计所需的当前章节边界`);
				continue;
			}
			const sectionContent = document.content.slice(sectionStart, sectionEnd);
			for (const phraseDefinition of section.phrases) {
				const phrase = phraseDefinition.text;
				const occurrences = [];
				let offset = sectionContent.indexOf(phrase);
				while (offset >= 0) {
					occurrences.push(offset);
					offset = sectionContent.indexOf(phrase, offset + phrase.length);
				}
				if (occurrences.length === 0) {
					failures.push(`${rule.label} 缺少当前候选语义：${phrase}`);
					continue;
				}
				for (const occurrence of occurrences) {
					const nearbyText = sectionContent.slice(occurrence, occurrence + 240);
					if (
						phraseDefinition.serverExpected === "full" &&
						!nearbyText.includes(baseline.serverRelease)
					) {
						failures.push(
							`${rule.label} 的“${phrase}”未指向当前服务端 release`,
						);
					}
					const expected =
						phraseDefinition.expected === "short"
							? baseline.miniProgramCommit
							: baseline.miniProgramSourceRevision;
					if (!nearbyText.includes(expected)) {
						failures.push(
							`${rule.label} 的“${phrase}”未指向当前完整小程序 sourceRevision`,
						);
					}
				}
			}
		}
	}
	return failures;
}

/**
 * 检查当前只读验收文档是否仍然尊重报告 Provider 的关闭边界。
 *
 * 报告页面已经存在，但目录/详情 gate 仍关闭；如果路线图只写“验收报告”而
 * 没有明确 fail-closed，下一次真机操作很容易把依赖未配置误认为真实空目录，
 * 或把页面渲染成功误认为 Provider 已迁移。因此把这条业务不变量放进发布
 * 基线门禁，要求路线图和 P0 手册同时表达“只验收安全失败边界”。未来正式
 * 打开 gate 时，必须同步修改这里的规则、Provider contract 和验收手册。
 */
export function auditCurrentReadonlyBusinessBoundaries(
	roadmapDocument,
	runbookDocument,
) {
	const failures = [];
	const executionSection = extractCurrentExecutionSection(roadmapDocument);
	if (!executionSection) {
		return ["当前只读业务边界无法定位路线图执行项"];
	}
	if (executionSection.includes("报告目录")) {
		if (!executionSection.includes("fail-closed")) {
			failures.push("报告目录当前执行项缺少 fail-closed 关闭边界");
		}
		if (!executionSection.includes("Provider contract")) {
			failures.push("报告目录当前执行项缺少 Provider contract 开放前置条件");
		}
		if (!executionSection.includes("不进行真实报告数据验收")) {
			failures.push("报告目录当前执行项未明确禁止真实报告数据验收");
		}
	}
	for (const requiredText of [
		"ZHONGYANG_REPORT_DIRECTORY_READY=false",
		"ZHONGYANG_REPORT_DETAIL_READY=false",
		"只允许验收 fail-closed",
	]) {
		if (!runbookDocument.includes(requiredText)) {
			failures.push(`P0 手册缺少报告关闭边界：${requiredText}`);
		}
	}
	return failures;
}

/**
 * 检查一组文档是否都写明同一套当前候选。
 * 返回低敏失败信息，便于本地门禁和测试复用，不输出 token、患者或 Provider 内容。
 */
export function auditCurrentBaselineDocuments(baseline, documents) {
	const failures = [];
	for (const document of documents) {
		if (!document.content.includes(baseline.serverRelease)) {
			failures.push(
				`${document.label} 缺少当前服务端 release ${baseline.serverRelease}`,
			);
		}
		if (!document.content.includes(baseline.miniProgramSourceRevision)) {
			failures.push(
				`${document.label} 缺少完整小程序 sourceRevision ${baseline.miniProgramSourceRevision}`,
			);
		}
	}
	const roadmap = documents.find(
		(document) => document.label === "下一阶段实施路线图",
	);
	const runbook = documents.find(
		(document) => document.label === "P0 只读业务验收手册",
	);
	if (roadmap) {
		failures.push(...auditCurrentExecutionSection(baseline, roadmap.content));
	}
	if (roadmap && runbook) {
		failures.push(
			...auditCurrentReadonlyBusinessBoundaries(
				roadmap.content,
				runbook.content,
			),
		);
	}
	failures.push(...auditCurrentCandidateReferences(baseline, documents));
	return {
		passed: failures.length === 0,
		serverRelease: baseline.serverRelease,
		miniProgramCommit: baseline.miniProgramCommit,
		miniProgramSourceRevision: baseline.miniProgramSourceRevision,
		failures,
	};
}

/** 读取当前仓库文档并执行发布基线一致性审计。 */
export async function auditCurrentReleaseConsistency(
	rootDirectory = repositoryRoot,
) {
	const candidatePath = join(rootDirectory, currentCandidateDocumentPath);
	const candidateDocument = await readFile(candidatePath, "utf8");
	const baseline = extractCurrentBaseline(candidateDocument);
	const documents = [];

	for (const document of currentBaselineDocuments) {
		const content = await readFile(join(rootDirectory, document.path), "utf8");
		documents.push({ ...document, content });
	}

	const documentAudit = auditCurrentBaselineDocuments(baseline, documents);
	const serverSourceAudit = auditServerSourceRelease(baseline, {
		rootDirectory,
	});
	return {
		...documentAudit,
		passed: documentAudit.passed && serverSourceAudit.passed,
		failures: [...documentAudit.failures, ...serverSourceAudit.failures],
		serverSourceAudit,
	};
}

if (import.meta.main) {
	try {
		const result = await auditCurrentReleaseConsistency();
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		console.error(
			`当前发布基线审计失败：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
