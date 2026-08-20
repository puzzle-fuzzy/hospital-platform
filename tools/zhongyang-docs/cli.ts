import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	runBrowserQuery,
	writeBrowserFailure,
	ZhongyangDocsError,
} from "./browser.ts";
import { classifyErrorStatus, createIntakeMarkdown } from "./core.ts";
import type { QueryConfig } from "./types.ts";

type ParsedArgs = Record<string, string | boolean>;

function parseArgs(argv: readonly string[]): ParsedArgs {
	const args: ParsedArgs = {};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (!argument?.startsWith("--")) continue;
		const [key, inlineValue] = argument.slice(2).split("=", 2);
		if (!key) continue;
		if (inlineValue !== undefined) {
			args[key] = inlineValue;
			continue;
		}
		const next = argv[index + 1];
		if (next && !next.startsWith("--")) {
			args[key] = next;
			index += 1;
		} else {
			args[key] = true;
		}
	}
	return args;
}

function stringArg(
	args: ParsedArgs,
	key: string,
	fallback?: string,
): string | undefined {
	const value = args[key];
	return typeof value === "string" ? value : fallback;
}

function booleanArg(args: ParsedArgs, key: string, fallback: boolean): boolean {
	const value = args[key];
	if (value === true) return true;
	if (typeof value !== "string") return fallback;
	return value !== "false" && value !== "0";
}

function numberArg(args: ParsedArgs, key: string, fallback: number): number {
	const value = Number(stringArg(args, key));
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envOrArg(
	args: ParsedArgs,
	arg: string,
	env: string,
	fallback?: string,
): string | undefined {
	return stringArg(args, arg, process.env[env] ?? fallback);
}

function usage(): string {
	return `众阳官方文档只读查询工具

入口：
  --url <https://openapi.msuncloud.com/document>  官方文档门户入口；默认使用众阳开放平台

常用：
  --query <2.6.65.2>                         接口编号，默认 2.6.65.2
  --search-selector <css>                    门户搜索框选择器
  --result-selector <css>                    结果项选择器
  --authenticated-selector <css>             登录后可见元素选择器
  --allowed-hosts <host1,host2>              允许采集响应的主机，默认门户主机
  --write-intake                            将 found 结果写入 docs/provider-intake/
  --headless=false                          默认 false，必须使用有界面浏览器完成验证码
  --help                                    显示帮助

环境变量：
  ZHONGYANG_DOCS_URL, ZHONGYANG_DOCS_QUERY, ZHONGYANG_DOCS_PROFILE_DIR,
  ZHONGYANG_DOCS_OUTPUT_DIR, ZHONGYANG_DOCS_SEARCH_SELECTOR,
  ZHONGYANG_DOCS_RESULT_SELECTOR, ZHONGYANG_DOCS_AUTHENTICATED_SELECTOR,
  ZHONGYANG_DOCS_ALLOWED_HOSTS, ZHONGYANG_DOCS_EXECUTABLE_PATH
`;
}

function buildConfig(args: ParsedArgs): QueryConfig {
	const portalUrl = envOrArg(
		args,
		"url",
		"ZHONGYANG_DOCS_URL",
		"https://openapi.msuncloud.com/document",
	);
	if (!portalUrl) throw new Error("缺少 --url 或 ZHONGYANG_DOCS_URL");
	const host = new URL(portalUrl).hostname.toLocaleLowerCase();
	const allowedHosts = (
		envOrArg(args, "allowed-hosts", "ZHONGYANG_DOCS_ALLOWED_HOSTS", host) ??
		host
	)
		.split(",")
		.map((item) => item.trim().toLocaleLowerCase())
		.filter(Boolean);
	const searchSelector = envOrArg(
		args,
		"search-selector",
		"ZHONGYANG_DOCS_SEARCH_SELECTOR",
	);
	const resultSelector = envOrArg(
		args,
		"result-selector",
		"ZHONGYANG_DOCS_RESULT_SELECTOR",
	);
	const authenticatedSelector = envOrArg(
		args,
		"authenticated-selector",
		"ZHONGYANG_DOCS_AUTHENTICATED_SELECTOR",
	);
	const executablePath = envOrArg(
		args,
		"executable-path",
		"ZHONGYANG_DOCS_EXECUTABLE_PATH",
	);
	return {
		portalUrl,
		query:
			envOrArg(args, "query", "ZHONGYANG_DOCS_QUERY", "2.6.65.2") ?? "2.6.65.2",
		profileDir: resolve(
			envOrArg(
				args,
				"profile-dir",
				"ZHONGYANG_DOCS_PROFILE_DIR",
				".local/zhongyang-docs/profile",
			) ?? ".local/zhongyang-docs/profile",
		),
		outputDir: resolve(
			envOrArg(
				args,
				"output-dir",
				"ZHONGYANG_DOCS_OUTPUT_DIR",
				".local/zhongyang-docs/queries",
			) ?? ".local/zhongyang-docs/queries",
		),
		headless: booleanArg(args, "headless", false),
		...(searchSelector ? { searchSelector } : {}),
		...(resultSelector ? { resultSelector } : {}),
		...(authenticatedSelector ? { authenticatedSelector } : {}),
		...(executablePath ? { executablePath } : {}),
		allowedHosts,
		timeoutMs: numberArg(args, "timeout-ms", 30_000),
		writeIntake: booleanArg(args, "write-intake", false),
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(usage());
		return;
	}
	const config = buildConfig(args);
	await mkdir(config.outputDir, { recursive: true });
	const stem = `${config.query.replace(/[^a-zA-Z0-9.-]+/gu, "-")}-${Date.now()}`;
	const jsonPath = resolve(config.outputDir, `${stem}.json`);
	try {
		const capture = await runBrowserQuery(config);
		await writeFile(jsonPath, JSON.stringify(capture, null, 2), "utf8");
		console.log(`查询状态：${capture.status}`);
		console.log(`结果 JSON：${jsonPath}`);
		if (capture.status === "found") {
			const markdown = createIntakeMarkdown(capture);
			const draftPath = resolve(config.outputDir, `${stem}.md`);
			await writeFile(draftPath, markdown, "utf8");
			console.log(`脱敏文档草稿：${draftPath}`);
			if (config.writeIntake) {
				const intakeFileName = `${config.query.replace(/[^a-zA-Z0-9.-]+/gu, "-")}.md`;
				const intakePath = resolve("docs/provider-intake", intakeFileName);
				await writeFile(intakePath, markdown, {
					encoding: "utf8",
					flag: "wx",
				});
				await registerIntakeEntry(intakeFileName);
				console.log(`已写入 Provider intake 草稿：${intakePath}`);
			}
		}
		if (capture.status === "unknown") {
			console.warn(
				"门户没有给出明确的结果、无权限或未找到提示；不能据此判定未授权。",
			);
		}
	} catch (error) {
		const status =
			error instanceof ZhongyangDocsError
				? error.status
				: classifyErrorStatus(
						error instanceof Error ? error.message : "查询失败",
					);
		const message = error instanceof Error ? error.message : "查询失败";
		const failurePath = resolve(config.outputDir, `${stem}.failure.json`);
		await writeBrowserFailure(failurePath, config, status, message);
		console.error(`查询失败：${status}：${message}`);
		console.error(`失败记录：${failurePath}`);
		process.exitCode = 1;
	}
}

async function registerIntakeEntry(fileName: string): Promise<void> {
	const docsReadmePath = resolve("docs/README.md");
	const content = await readFile(docsReadmePath, "utf8");
	const relativePath = `provider-intake/${fileName}`;
	if (content.includes(relativePath)) return;
	const entry = `| [\`${relativePath}\`](${relativePath}) | 浏览器采集的众阳接口文档脱敏草稿；当前为 \`normalized\`，待人工 contract 复核 |`;
	const anchor = "| [`medical-insurance-contract-v1.md`]";
	if (!content.includes(anchor)) {
		throw new Error("docs/README.md 缺少 Provider 文档索引插入位置");
	}
	await writeFile(
		docsReadmePath,
		content.replace(anchor, `${entry}\n${anchor}`),
		"utf8",
	);
}

await main();
