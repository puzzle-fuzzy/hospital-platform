import { afterEach, expect, test } from "bun:test";
import { ApiError, downloadOutpatientInvoiceResource } from "./api-client";
import {
	clearApiRequestObservations,
	getRecentApiRequestObservations,
} from "./api-request-observability";
import {
	classifyInvoiceResourceNetworkFailure,
	invoiceResourceErrorData,
} from "./outpatient-invoice-resource";

type ResourceRequestOptions = {
	url: string;
	method: string;
	responseType: string;
	dataType: string;
	timeout: number;
	header: Record<string, string>;
	success(response: {
		data: unknown;
		header: Record<string, string>;
		statusCode: number;
	}): void;
	fail(error: { errMsg: string; errCode?: unknown }): void;
};
const globals = new Map(
	["wx", "getApp", "Page", "fetch"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
);
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);
const PDF = new TextEncoder().encode("%PDF-1.7\nfixture");
const PATIENT = {
	id: "invoice-patient-001",
	displayName: "测试患者",
	relationship: "self" as const,
	cardNumberMasked: "123***456",
	source: "hospital-his" as const,
	clinicalAccess: "ready" as const,
};
afterEach(() => {
	clearApiRequestObservations();
	for (const [name, descriptor] of globals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});

async function fixture() {
	const app = {
		globalData: {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "invoice-test-session",
			sessionStatus: "signed_in",
			sessionGeneration: 17,
		},
	};
	let selectedPatientId = PATIENT.id;
	const files = new Map<string, Uint8Array>();
	const removed: string[] = [];
	const requests: Array<{ options: ResourceRequestOptions }> = [];
	const writes: string[] = [];
	let storageFailure: "none" | "partial-write" | "corrupt-write" = "none";
	let onWrite: (() => void) | undefined;
	Object.assign(globalThis, {
		getApp: () => app,
		fetch: () => {
			throw new Error("Invoice regression must not use the network");
		},
		wx: {
			env: { USER_DATA_PATH: "wxfile://usr" },
			getStorageSync: (key: string) =>
				key === "selected_patient_id" ? selectedPatientId : "",
			setStorageSync: (key: string, value: string) => {
				if (key === "selected_patient_id") selectedPatientId = value;
			},
			removeStorageSync: () => undefined,
			getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
			getFileSystemManager: () => ({
				statSync: (path: string) => {
					const data = files.get(path);
					if (!data) throw new Error("missing fixture file");
					return { size: data.byteLength };
				},
				readFileSync: (
					path: string,
					encoding?: string,
					position = 0,
					length?: number,
				) => {
					const data = files.get(path);
					if (!data) throw new Error("missing fixture file");
					return encoding === "utf8"
						? new TextDecoder().decode(data)
						: data.slice(
								position,
								length === undefined ? undefined : position + length,
							).buffer;
				},
				writeFileSync: (path: string, data: string | ArrayBuffer) => {
					writes.push(path);
					files.set(
						path,
						typeof data === "string"
							? new Uint8Array(Buffer.from(data, "base64"))
							: new Uint8Array(data.slice(0)),
					);
					onWrite?.();
					if (storageFailure === "partial-write") {
						throw new Error("synthetic storage full");
					}
					if (storageFailure === "corrupt-write") {
						files.set(path, new Uint8Array(8));
					}
				},
				unlinkSync: (path: string) => {
					removed.push(path);
					files.delete(path);
				},
			}),
			request: (options: ResourceRequestOptions) => {
				requests.push({ options });
				return { abort: () => undefined };
			},
			downloadFile: () => {
				throw new Error("Invoice transport must use the platform request");
			},
		},
	});
	const finish = (
		index: number,
		bytes = PNG,
		mime = "image/png",
		statusCode = 200,
		extraHeaders: Record<string, string> = {},
	) => {
		const request = requests[index];
		if (!request) throw new Error("No fixture resource request");
		const beforeWrites = writes.length;
		request.options.success({
			data: bytes.slice().buffer,
			statusCode,
			header: {
				"Content-Type": mime,
				"Content-Length": String(bytes.byteLength),
				...extraHeaders,
			},
		});
		return writes.length > beforeWrites ? (writes.at(-1) ?? "") : "";
	};
	return {
		app,
		files,
		removed,
		requests,
		writes,
		finish,
		failStorage: (value: typeof storageFailure) => {
			storageFailure = value;
		},
		duringWrite: (callback: () => void) => {
			onWrite = callback;
		},
		select: (id: string) => {
			selectedPatientId = id;
		},
	};
}

test("票据下载只发送平台患者引用与Bearer，PNG/JPEG/PDF按真实类型识别", async () => {
	const f = await fixture();
	for (const [bytes, mime, kind] of [
		[PNG, "image/png", "image"],
		[JPEG, "image/jpeg", "image"],
		[PDF, "application/pdf", "pdf"],
	] as const) {
		const promise = downloadOutpatientInvoiceResource(
			PATIENT.id,
			"record/encoded",
			17,
		);
		const index = f.requests.length - 1;
		expect(f.requests[index]?.options.url).toBe(
			"https://test-hp.meiyi.pro/api/v2/payments/outpatient/invoices/record%2Fencoded/resource?patientId=invoice-patient-001",
		);
		expect(f.requests[index]?.options.header.Authorization).toBe(
			"Bearer invoice-test-session",
		);
		expect(f.requests[index]?.options).toMatchObject({
			method: "GET",
			responseType: "arraybuffer",
			dataType: "other",
			timeout: 30_000,
		});
		const path = f.finish(index, bytes, mime);
		await expect(promise).resolves.toEqual({ tempFilePath: path, kind });
	}
});

test("伪造图片响应、超大文件声明及HTML均不进入预览并清理文件", async () => {
	const f = await fixture();
	for (const [bytes, mime, headers] of [
		[new TextEncoder().encode("<html>not an image</html>"), "image/png", {}],
		[PNG, "application/pdf", {}],
		[PNG, "image/png", { "Content-Length": "999999999" }],
		[PNG, "text/html", {}],
	] as const) {
		const promise = downloadOutpatientInvoiceResource(
			PATIENT.id,
			"invoice-record-001",
			17,
		);
		const path = f.finish(f.requests.length - 1, bytes, mime, 200, headers);
		await expect(promise).rejects.toMatchObject({
			code: "provider-response-invalid",
		});
		expect(f.writes).toHaveLength(0);
		expect(path).toBe("");
	}
});

test("实际文件超过上限时即使声明很小且魔数正确也不接受", async () => {
	const f = await fixture();
	const bytes = new Uint8Array(12 * 1024 * 1024 + 1);
	bytes.set(PNG);
	const promise = downloadOutpatientInvoiceResource(
		PATIENT.id,
		"invoice-record-001",
		17,
	);
	const path = f.finish(0, bytes, "image/png", 200, { "Content-Length": "12" });
	await expect(promise).rejects.toMatchObject({
		code: "provider-response-invalid",
	});
	expect(f.writes).toHaveLength(0);
	expect(path).toBe("");
});

test("下载JSON错误保留服务端错误码并清理文件，401清理会话", async () => {
	const f = await fixture();
	const promise = downloadOutpatientInvoiceResource(
		PATIENT.id,
		"invoice-record-001",
		17,
	);
	const path = f.finish(
		0,
		new TextEncoder().encode(
			JSON.stringify({
				success: false,
				error: {
					code: "unauthorized",
					message: "登录已过期",
					numericCode: 10100,
				},
			}),
		),
		"application/json",
		401,
	);
	await expect(promise).rejects.toBeInstanceOf(ApiError);
	expect(f.app.globalData.accessToken).toBe("");
	expect(f.writes).toHaveLength(0);
	expect(path).toBe("");
});

test("票据下载前后阻断会话与患者变化，旧文件被清理", async () => {
	const f = await fixture();
	f.select("invoice-patient-002");
	expect(() =>
		downloadOutpatientInvoiceResource(PATIENT.id, "invoice-record-001", 17),
	).toThrow();
	expect(f.requests).toHaveLength(0);
	f.select(PATIENT.id);
	const oldPatient = downloadOutpatientInvoiceResource(
		PATIENT.id,
		"invoice-record-001",
		17,
	);
	f.select("invoice-patient-002");
	const patientPath = f.finish(0);
	await expect(oldPatient).rejects.toMatchObject({
		code: "patient-selection-stale",
	});
	expect(patientPath).toBe("");
	expect(f.writes).toHaveLength(0);
	f.select(PATIENT.id);
	const oldSession = downloadOutpatientInvoiceResource(
		PATIENT.id,
		"invoice-record-001",
		17,
	);
	f.app.globalData.sessionGeneration = 18;
	const sessionPath = f.finish(1);
	await expect(oldSession).rejects.toMatchObject({ code: "session-changed" });
	expect(sessionPath).toBe("");
	expect(f.writes).toHaveLength(0);
});

test("医院超时JSON保留10810和服务端关联号，不落盘、不自动重试", async () => {
	const f = await fixture();
	const promise = downloadOutpatientInvoiceResource(
		PATIENT.id,
		"record-001",
		17,
	);
	f.requests[0]?.options.success({
		statusCode: 503,
		header: {
			"Content-Type": "application/json",
			"X-Request-ID": "invoice-server-trace",
		},
		data: new TextEncoder().encode(
			JSON.stringify({
				success: false,
				error: {
					code: "provider-temporarily-unavailable",
					numericCode: 10810,
					message: "票据源站暂时不可用",
				},
			}),
		).buffer,
	});
	await expect(promise).rejects.toMatchObject({
		statusCode: 503,
		code: "provider-temporarily-unavailable",
		numericCode: 10810,
		requestId: "invoice-server-trace",
	});
	expect(f.writes).toHaveLength(0);
	expect(f.requests).toHaveLength(1);
});

test("错误JSON使用严格有界UTF8解码且无需真机TextDecoder", () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, "TextDecoder");
	const error = {
		error: { message: "源站超时，请稍后重试", numericCode: 10810 },
	};
	const body = new TextEncoder().encode(JSON.stringify(error));
	const exact = new Uint8Array(65_536).fill(0x20);
	exact.set(body);
	const tooLarge = new Uint8Array(65_537).fill(0x20);
	tooLarge.set(body);
	try {
		Object.defineProperty(globalThis, "TextDecoder", {
			configurable: true,
			value: undefined,
		});
		expect(invoiceResourceErrorData(body.buffer)).toEqual(error);
		expect(invoiceResourceErrorData(exact.buffer)).toEqual(error);
		expect(invoiceResourceErrorData(tooLarge.buffer)).toEqual({});
		expect(
			invoiceResourceErrorData(new Uint8Array([0xc0, 0xaf]).buffer),
		).toEqual({});
		expect(invoiceResourceErrorData(new ArrayBuffer(0))).toEqual({});
		expect(invoiceResourceErrorData('{"error":{}}')).toEqual({});
	} finally {
		if (original) Object.defineProperty(globalThis, "TextDecoder", original);
		else Reflect.deleteProperty(globalThis, "TextDecoder");
	}
});

test("非ArrayBuffer成功响应和空影像不能写成票据", async () => {
	const f = await fixture();
	for (const data of ["not bytes", { data: PNG }, new ArrayBuffer(0), PNG]) {
		const promise = downloadOutpatientInvoiceResource(
			PATIENT.id,
			"record-001",
			17,
		);
		f.requests.at(-1)?.options.success({
			statusCode: 200,
			header: { "Content-Type": "image/png" },
			data,
		});
		await expect(promise).rejects.toMatchObject({
			code: "provider-response-invalid",
		});
	}
	expect(f.writes).toHaveLength(0);
});

test("8MiB真实边界以内可保存，超一字节不能写入且不信虚假长度", async () => {
	const f = await fixture();
	const bytes = new Uint8Array(8 * 1024 * 1024);
	bytes.set(PNG);
	const accepted = downloadOutpatientInvoiceResource(
		PATIENT.id,
		"record-001",
		17,
	);
	const path = f.finish(0, bytes);
	await expect(accepted).resolves.toMatchObject({
		tempFilePath: path,
		kind: "image",
	});
	expect(f.files.get(path)?.byteLength).toBe(bytes.byteLength);
	const oversized = new Uint8Array(bytes.byteLength + 1);
	oversized.set(PNG);
	const denied = downloadOutpatientInvoiceResource(
		PATIENT.id,
		"record-001",
		17,
	);
	f.finish(1, oversized, "image/png", 200, { "Content-Length": "12" });
	await expect(denied).rejects.toMatchObject({
		code: "provider-response-invalid",
	});
	expect(f.writes).toHaveLength(1);
});

test("保存部分失败或写后内容损坏均删除本次文件", async () => {
	for (const failure of ["partial-write", "corrupt-write"] as const) {
		const f = await fixture();
		f.failStorage(failure);
		const promise = downloadOutpatientInvoiceResource(
			PATIENT.id,
			"record-001",
			17,
		);
		const path = f.finish(0);
		await expect(promise).rejects.toMatchObject({
			code: "provider-response-invalid",
		});
		expect(path).toStartWith("wxfile://usr/invoice-resource-17-");
		expect(f.removed).toContain(path);
		expect(f.files.size).toBe(0);
	}
});

test("保存期间患者改变会清理文件，旧401不能清掉新会话", async () => {
	const f = await fixture();
	f.duringWrite(() => f.select("another-patient"));
	const pending = downloadOutpatientInvoiceResource(
		PATIENT.id,
		"record-001",
		17,
	);
	const path = f.finish(0);
	await expect(pending).rejects.toMatchObject({
		code: "patient-selection-stale",
	});
	expect(f.files.size).toBe(0);
	expect(f.removed).toContain(path);
	f.select(PATIENT.id);
	const oldSession = downloadOutpatientInvoiceResource(
		PATIENT.id,
		"record-001",
		17,
	);
	f.app.globalData.accessToken = "new-fixture-session";
	f.app.globalData.sessionGeneration = 18;
	f.finish(
		1,
		new TextEncoder().encode(
			JSON.stringify({ error: { code: "unauthorized" } }),
		),
		"application/json",
		401,
	);
	await expect(oldSession).rejects.toMatchObject({ code: "session-changed" });
	expect(f.app.globalData.accessToken).toBe("new-fixture-session");
});

test("响应头大小写及MIME参数兼容，独立文件名不携带患者或票据引用", async () => {
	const f = await fixture();
	const paths: string[] = [];
	for (let index = 0; index < 2; index++) {
		const pending = downloadOutpatientInvoiceResource(
			PATIENT.id,
			"private-record-reference",
			17,
		);
		f.requests.at(-1)?.options.success({
			statusCode: 200,
			header: {
				"cOnTeNt-TyPe": " Application/PDF; charset=binary",
				"CONTENT-LENGTH": String(PDF.byteLength),
			},
			data: PDF.slice().buffer,
		});
		const saved = await pending;
		expect(saved.kind).toBe("pdf");
		expect(saved.tempFilePath).toEndWith(".pdf");
		expect(saved.tempFilePath).not.toContain(PATIENT.id);
		expect(saved.tempFilePath).not.toContain("private-record-reference");
		paths.push(saved.tempFilePath);
	}
	expect(new Set(paths).size).toBe(2);
});

test("网络失败只记录固定分类及有界数字，不记录原始微信错误或地址", async () => {
	const f = await fixture();
	const secret = "invoice-secret-canary-0297";
	const cases = [
		["request:fail timeout", "timeout"],
		["request:fail url not in domain list", "domain-not-allowed"],
		[
			`request:fail SSL handshake https://private.example/?token=${secret}`,
			"tls-failed",
		],
		["request:fail DNS resolution failed", "dns-failed"],
		["request:fail connection refused", "connection-failed"],
		["request:fail abort", "aborted"],
		[`request:fail internal ${secret}`, "unknown"],
	] as const;
	for (const [errMsg, reason] of cases) {
		const pending = downloadOutpatientInvoiceResource(
			PATIENT.id,
			"record-001",
			17,
		);
		f.requests.at(-1)?.options.fail({ errMsg, errCode: -1200 });
		await expect(pending).rejects.toMatchObject({
			code: reason === "timeout" ? "request-timeout" : "network-failed",
		});
		expect(getRecentApiRequestObservations().at(-1)).toMatchObject({
			transport: "request",
			networkFailureReason: reason,
			networkErrorCode: -1200,
		});
	}
	const observations = JSON.stringify(getRecentApiRequestObservations());
	expect(observations).not.toContain(secret);
	expect(observations).not.toContain("private.example");
	expect(observations).not.toContain("errMsg");
	expect(f.requests).toHaveLength(cases.length);
	expect(f.writes).toHaveLength(0);
	for (const errCode of [
		"-1200",
		`https://private.example/?token=${secret}`,
		Infinity,
		NaN,
		0.5,
		1_000_001,
		Number.MAX_SAFE_INTEGER,
		{ token: secret },
	]) {
		expect(classifyInvoiceResourceNetworkFailure({ errCode })).toEqual({
			networkFailureReason: "unknown",
		});
	}
});

test("旧电子票据路由只显示导诊机打印指引，不读取会话或触发任何票据操作", async () => {
	type GuidePage = {
		data: { printHint: string };
		onLoad?: () => void;
		onShow?: () => void;
		onPullDownRefresh?: () => void;
		onUnload?: () => void;
	};
	let captured: unknown;
	const accesses: string[] = [];
	const forbidden = (name: string): never => {
		accesses.push(name);
		throw new Error(`Print guidance must not invoke ${name}`);
	};
	Object.assign(globalThis, {
		Page: (value: unknown) => {
			captured = value;
		},
		getApp: () => forbidden("getApp"),
		fetch: () => forbidden("fetch"),
		wx: new Proxy(
			{},
			{ get: (_target, name) => forbidden(`wx.${String(name)}`) },
		),
	});
	const modulePath =
		"../pages/outpatient-electronic-invoice/outpatient-electronic-invoice";
	await import(`${modulePath}.ts?invoice-print-guidance-test`);
	const page = captured as GuidePage | undefined;
	if (!page) throw new Error("Invoice print guide not registered");
	page.onLoad?.();
	page.onShow?.();
	page.onPullDownRefresh?.();
	page.onUnload?.();
	expect(page.data.printHint).toBe("请前往导诊机自主打印发票");
	expect(accesses).toEqual([]);
	const template = await Bun.file(
		new URL(
			"../pages/outpatient-electronic-invoice/outpatient-electronic-invoice.wxml",
			import.meta.url,
		),
	).text();
	expect(template).toContain("{{printHint}}");
	expect(template.trimStart()).toStartWith(
		'<scroll-view class="secondary-page-scroll"',
	);
	expect(template).toContain('scroll-y="true"');
	expect(template).not.toMatch(/bindtap|<button|patient-hospital-context/u);
	const configuration = await Bun.file(
		new URL(
			"../pages/outpatient-electronic-invoice/outpatient-electronic-invoice.json",
			import.meta.url,
		),
	).json();
	expect(configuration.navigationBarTitleText).toBe("发票打印");
	expect(configuration.enablePullDownRefresh).toBe(false);
	expect(configuration.usingComponents).toBeUndefined();
});
