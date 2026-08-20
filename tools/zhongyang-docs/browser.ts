import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Locator, type Page, type Response } from "playwright";
import {
	classifyQuery,
	sanitizeNetworkBody,
	sanitizeNetworkObservation,
	sanitizeText,
	sanitizeUrl,
} from "./core.ts";
import type { NetworkObservation, QueryCapture, QueryConfig } from "./types.ts";

const SEARCH_SELECTORS = [
	'[role="searchbox"]',
	'input[type="search"]',
	'input[placeholder*="搜索"]',
	'input[placeholder*="接口"]',
	'input[placeholder*="关键字"]',
	'input[name*="search"]',
	'input[name*="keyword"]',
];
const RESULT_SELECTORS = [
	"a",
	"button",
	'[role="link"]',
	'[role="button"]',
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"table tr",
	".catalog_tree .el-tree-node__content",
];
const SEARCH_BUTTON_SELECTORS = [
	'button:has-text("搜索")',
	'[role="button"]:has-text("搜索")',
	'input[type="submit"]',
];
const MAX_NETWORK_BODY_BYTES = 1_000_000;
const CAPTURE_RESOURCE_TYPES = new Set(["xhr", "fetch", "document"]);

export class ZhongyangDocsError extends Error {
	readonly status: "ui_changed" | "upstream_error" | "session_expired";

	constructor(
		status: "ui_changed" | "upstream_error" | "session_expired",
		message: string,
	) {
		super(message);
		this.name = "ZhongyangDocsError";
		this.status = status;
	}
}

function assertPortalUrl(config: QueryConfig): void {
	const url = new URL(config.portalUrl);
	const isLocalHttp =
		url.protocol === "http:" &&
		(url.hostname === "localhost" || url.hostname === "127.0.0.1");
	if (url.protocol !== "https:" && !isLocalHttp) {
		throw new ZhongyangDocsError(
			"upstream_error",
			"门户地址必须使用 HTTPS；仅允许 localhost/127.0.0.1 使用 HTTP 调试",
		);
	}
	if (
		config.allowedHosts.length > 0 &&
		!config.allowedHosts.includes(url.hostname.toLocaleLowerCase())
	) {
		throw new ZhongyangDocsError(
			"upstream_error",
			`门户主机不在允许列表中：${url.hostname}`,
		);
	}
}

function isAllowedResponse(response: Response, config: QueryConfig): boolean {
	try {
		const url = new URL(response.url());
		return config.allowedHosts.includes(url.hostname.toLocaleLowerCase());
	} catch {
		return false;
	}
}

async function visibleCount(page: Page, selector: string): Promise<number> {
	const locator = page.locator(selector);
	let count = 0;
	for (let index = 0; index < (await locator.count()); index += 1) {
		if (
			await locator
				.nth(index)
				.isVisible()
				.catch(() => false)
		)
			count += 1;
	}
	return count;
}

async function firstVisible(
	page: Page,
	selector: string,
): Promise<Locator | undefined> {
	const locator = page.locator(selector);
	for (let index = 0; index < (await locator.count()); index += 1) {
		const candidate = locator.nth(index);
		if (await candidate.isVisible().catch(() => false)) return candidate;
	}
	return undefined;
}

async function findUniqueVisibleLocator(
	page: Page,
	selectors: readonly string[],
	label: string,
): Promise<Locator> {
	const matches: Array<{ selector: string; count: number }> = [];
	for (const selector of selectors) {
		const count = await visibleCount(page, selector);
		if (count > 0) matches.push({ selector, count });
	}
	const unique = matches.filter((item) => item.count === 1);
	if (unique.length !== 1) {
		throw new ZhongyangDocsError(
			"ui_changed",
			`${label}无法唯一定位，请通过环境变量提供选择器；候选=${JSON.stringify(matches)}`,
		);
	}
	const locator = await firstVisible(page, unique[0]?.selector ?? "");
	if (!locator) throw new ZhongyangDocsError("ui_changed", `${label}不可见`);
	return locator;
}

async function captureResponse(
	response: Response,
	config: QueryConfig,
): Promise<NetworkObservation | undefined> {
	if (!isAllowedResponse(response, config)) return undefined;
	const resourceType = response.request().resourceType();
	if (!CAPTURE_RESOURCE_TYPES.has(resourceType)) return undefined;
	const headers = response.headers();
	const contentType = headers["content-type"] ?? "";
	const observation: NetworkObservation = {
		method: response.request().method(),
		url: response.url(),
		status: response.status(),
		contentType,
		resourceType,
	};
	if (
		resourceType === "document" ||
		!/(json|text|html|javascript)/iu.test(contentType)
	) {
		return sanitizeNetworkObservation(observation);
	}
	try {
		const body = await response.body();
		if (body.byteLength <= MAX_NETWORK_BODY_BYTES) {
			return sanitizeNetworkObservation({
				...observation,
				body: sanitizeNetworkBody(new TextDecoder().decode(body)),
			});
		}
		return sanitizeNetworkObservation({
			...observation,
			body: "[BODY_TRUNCATED]",
		});
	} catch {
		return sanitizeNetworkObservation(observation);
	}
}

async function listResultLabels(page: Page, query: string): Promise<string[]> {
	const labels: string[] = [];
	const locator = page.locator(RESULT_SELECTORS.join(","));
	const count = Math.min(await locator.count(), 500);
	for (let index = 0; index < count; index += 1) {
		const item = locator.nth(index);
		if (!(await item.isVisible().catch(() => false))) continue;
		const text = (await item.innerText().catch(() => "")).trim();
		if (!text?.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
			continue;
		if (!labels.includes(text)) labels.push(sanitizeText(text, 2_000));
	}
	return labels.slice(0, 50);
}

async function clickFirstResult(page: Page, query: string): Promise<boolean> {
	const locator = page
		.locator(
			'a,button,[role="link"],[role="button"],.catalog_tree .el-tree-node__content',
		)
		.filter({
			hasText: query,
		});
	for (let index = 0; index < (await locator.count()); index += 1) {
		const candidate = locator.nth(index);
		if (!(await candidate.isVisible().catch(() => false))) continue;
		await candidate.click({ timeout: 5_000 });
		await page
			.waitForLoadState("domcontentloaded", { timeout: 5_000 })
			.catch(() => undefined);
		await page.waitForTimeout(500);
		return true;
	}
	return false;
}

async function readPageText(page: Page): Promise<string> {
	return sanitizeText(await page.locator("body").innerText({ timeout: 5_000 }));
}

export async function runBrowserQuery(
	config: QueryConfig,
): Promise<QueryCapture> {
	assertPortalUrl(config);
	await mkdir(config.profileDir, { recursive: true });

	const context = await chromium.launchPersistentContext(config.profileDir, {
		headless: config.headless,
		...(config.executablePath ? { executablePath: config.executablePath } : {}),
		viewport: { width: 1440, height: 1000 },
		acceptDownloads: false,
	});
	const pendingResponses: Promise<void>[] = [];
	const observations = new Map<string, NetworkObservation>();
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto(config.portalUrl, {
			waitUntil: "domcontentloaded",
			timeout: config.timeoutMs,
		});
		await dismissGuidanceTour(page);
		await prepareLogin(page, config);
		if (
			config.authenticatedSelector &&
			(await visibleCount(page, config.authenticatedSelector)) === 0
		) {
			throw new ZhongyangDocsError(
				"session_expired",
				"登录确认选择器不可见，当前会话可能未完成登录",
			);
		}

		const searchInput = config.searchSelector
			? await firstVisible(page, config.searchSelector)
			: await findUniqueVisibleLocator(page, SEARCH_SELECTORS, "搜索输入框");
		if (!searchInput)
			throw new ZhongyangDocsError("ui_changed", "搜索输入框不可见");

		const onResponse = (response: Response) => {
			const task = captureResponse(response, config).then((observation) => {
				if (!observation) return;
				const key = `${observation.method} ${observation.url} ${observation.status}`;
				if (observations.size < 100 || observations.has(key))
					observations.set(key, observation);
			});
			pendingResponses.push(task);
		};
		page.on("response", onResponse);
		await searchInput.fill(config.query);
		await searchInput.press("Enter").catch(() => undefined);
		await page.waitForTimeout(1_000);
		for (const selector of SEARCH_BUTTON_SELECTORS) {
			const button = await firstVisible(page, selector);
			if (button) {
				await button.click({ timeout: 3_000 }).catch(() => undefined);
				break;
			}
		}
		await page.waitForTimeout(1_500);
		const resultLabels = config.resultSelector
			? await readConfiguredResults(page, config.resultSelector, config.query)
			: await listResultLabels(page, config.query);
		if (resultLabels.length > 0) await clickFirstResult(page, config.query);
		await page.waitForTimeout(500);
		await Promise.allSettled(pendingResponses);

		const visibleText = await readPageText(page);
		const responseStatuses = [...observations.values()].map(
			(item) => item.status,
		);
		const status = classifyQuery({
			visibleText,
			matchedResultCount: resultLabels.length,
			responseStatuses,
		});
		return {
			query: config.query,
			status,
			title: sanitizeText(await page.title()),
			pageUrl: sanitizeUrl(page.url()),
			capturedAt: new Date().toISOString(),
			visibleText,
			resultLabels,
			matchedResultCount: resultLabels.length,
			network: [...observations.values()],
			notes: [
				"本次查询使用人工完成的登录/验证码会话。",
				"网络响应只记录允许主机的页面请求，未记录请求头、Cookie 或浏览器存储。",
			],
		};
	} catch (error) {
		if (error instanceof ZhongyangDocsError) throw error;
		throw new ZhongyangDocsError(
			"upstream_error",
			error instanceof Error ? error.message : "浏览器查询失败",
		);
	} finally {
		await context.close();
	}
}

async function prepareLogin(page: Page, config: QueryConfig): Promise<void> {
	const host = new URL(config.portalUrl).hostname.toLocaleLowerCase();
	if (host !== "openapi.msuncloud.com") {
		console.log(
			"浏览器已打开。请在浏览器中完成官方门户登录和验证码，然后回到终端按回车继续。",
		);
		await waitForEnter();
		return;
	}

	const loginTrigger = await firstVisible(
		page,
		'#loginBtn span:has-text("登 录")',
	);
	if (!loginTrigger) {
		console.log("已检测到当前门户已有登录会话，继续查询。");
		return;
	}
	await loginTrigger.click({ timeout: 5_000 });
	const dialog = page.locator(".login-dialog").first();
	await dialog.waitFor({ state: "visible", timeout: 5_000 });
	const appIdTab = dialog
		.locator(".login-type-tabs .el-radio-button__inner")
		.filter({ hasText: /应用密钥登[录陆]/u })
		.first();
	if (!(await appIdTab.isVisible().catch(() => false))) {
		throw new ZhongyangDocsError("ui_changed", "未找到“应用密钥登录”选项卡");
	}
	await appIdTab.click();

	const loginNameInput = dialog.locator('input[placeholder="请输入应用ID"]');
	const secretInput = dialog.locator('input[placeholder="请输入应用密钥"]');
	if (
		!(await loginNameInput.isVisible().catch(() => false)) ||
		!(await secretInput.isVisible().catch(() => false))
	) {
		throw new ZhongyangDocsError(
			"ui_changed",
			"未找到应用 ID 或应用密钥输入框",
		);
	}
	const loginName = await promptLine("请输入应用 ID（不会写入文件）：");
	const applicationSecret = await promptHidden(
		"请输入应用密钥（输入不回显）：",
	);
	await loginNameInput.fill(loginName);
	await secretInput.fill(applicationSecret);
	console.log(
		"应用 ID 和应用密钥已填入浏览器。请在浏览器内输入验证码，然后回到终端按 Enter 提交。",
	);
	await waitForEnter();

	const responsePromise = page
		.waitForResponse(
			(response) => {
				try {
					return new URL(response.url()).pathname === "/portal/service/login";
				} catch {
					return false;
				}
			},
			{ timeout: 15_000 },
		)
		.catch(() => undefined);
	const submit = dialog
		.locator(".el-dialog__footer button")
		.filter({ hasText: "确 定" })
		.first();
	if (!(await submit.isVisible().catch(() => false))) {
		throw new ZhongyangDocsError("ui_changed", "未找到登录确认按钮");
	}
	await submit.click();
	const response = await responsePromise;
	const responseText = response ? await response.text().catch(() => "") : "";
	if (responseText.includes("VERIFY_CODE_ERROR")) {
		throw new ZhongyangDocsError(
			"upstream_error",
			"门户验证码校验失败，请刷新验证码后重试",
		);
	}
	if (responseText.includes("APPID_LOGIN_FAIL")) {
		throw new ZhongyangDocsError(
			"upstream_error",
			"门户应用 ID 或应用密钥认证失败",
		);
	}

	const mfa = page.locator('.el-dialog:has-text("MFA")').first();
	if (await mfa.isVisible().catch(() => false)) {
		console.log(
			"门户要求额外 MFA。请在浏览器内完成 MFA 弹窗，然后回到终端按 Enter。",
		);
		await waitForEnter();
	}
	await page
		.locator('#loginBtn span:has-text("登 录")')
		.waitFor({ state: "hidden", timeout: 15_000 })
		.catch(() => undefined);
	if (await firstVisible(page, '#loginBtn span:has-text("登 录")')) {
		throw new ZhongyangDocsError(
			"upstream_error",
			"门户登录未完成，请检查验证码或 MFA 状态",
		);
	}
}

async function dismissGuidanceTour(page: Page): Promise<void> {
	const closeButton = await firstVisible(page, ".el-tour__closebtn");
	if (!closeButton) return;
	await closeButton.click({ timeout: 5_000 });
	await page.waitForTimeout(200);
}

async function readConfiguredResults(
	page: Page,
	selector: string,
	query: string,
): Promise<string[]> {
	const locator = page.locator(selector);
	const labels: string[] = [];
	for (
		let index = 0;
		index < Math.min(await locator.count(), 500);
		index += 1
	) {
		const item = locator.nth(index);
		if (!(await item.isVisible().catch(() => false))) continue;
		const text = (await item.innerText().catch(() => "")).trim();
		if (text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
			labels.push(sanitizeText(text, 2_000));
		}
	}
	return [...new Set(labels)].slice(0, 50);
}

async function waitForEnter(): Promise<void> {
	const { createInterface } = await import("node:readline/promises");
	const { stdin, stdout } = await import("node:process");
	const readline = createInterface({ input: stdin, output: stdout });
	try {
		await readline.question("完成后按 Enter：");
	} finally {
		readline.close();
	}
}

async function promptLine(label: string): Promise<string> {
	const { createInterface } = await import("node:readline/promises");
	const { stdin, stdout } = await import("node:process");
	const readline = createInterface({ input: stdin, output: stdout });
	try {
		return (await readline.question(label)).trim();
	} finally {
		readline.close();
	}
}

async function promptHidden(label: string): Promise<string> {
	const { stdin, stdout } = await import("node:process");
	if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
		return promptLine(`${label}（当前终端不支持隐藏输入）：`);
	}
	stdout.write(label);
	return new Promise<string>((resolve, reject) => {
		let value = "";
		const cleanup = () => {
			stdin.setRawMode?.(false);
			stdin.pause();
			stdin.removeListener("data", onData);
			stdout.write("\n");
		};
		const onData = (chunk: Buffer | string) => {
			for (const character of chunk.toString()) {
				if (character === "\r" || character === "\n") {
					cleanup();
					resolve(value);
					return;
				}
				if (character === "\u0003") {
					cleanup();
					reject(new Error("用户取消了凭据输入"));
					return;
				}
				if (character === "\b" || character === "\u007f") {
					value = value.slice(0, -1);
					continue;
				}
				value += character;
			}
		};
		stdin.setRawMode(true);
		stdin.resume();
		stdin.on("data", onData);
	});
}

export async function writeBrowserFailure(
	path: string,
	config: QueryConfig,
	status: string,
	error: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		JSON.stringify(
			{
				query: config.query,
				status,
				error: sanitizeText(error, 4_000),
				capturedAt: new Date().toISOString(),
			},
			null,
			2,
		),
		"utf8",
	);
}
