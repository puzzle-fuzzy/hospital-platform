import { expect, test } from "bun:test";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { createZhongyangOutpatientElectronicInvoiceResourceGateway } from "./zhongyang-outpatient-invoice-resource";

const origin = "http://111.111.111.52:18003";
const h5 = `${origin}/medical-web/industryMain.do?method=displayH5&ciphertext=aabbccdd`;
const context = { traceId: "invoice-resource-001", idempotencyKey: "view-001" };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const pdf = new TextEncoder().encode("%PDF-1.7\nexample");
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 1]);

function image(body = png, declared = "image/png") {
	return new Response(body, { headers: { "content-type": declared } });
}

test("票据资源仅GET并且不传平台或医院凭据，不跟随重定向", async () => {
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		fetcher: async (url, init) => {
			expect(String(url)).toBe(h5);
			expect(init?.method).toBe("GET");
			expect(init?.redirect).toBe("manual");
			const headers = new Headers(init?.headers);
			expect(headers.has("authorization")).toBe(false);
			expect(headers.has("cookie")).toBe(false);
			expect(headers.has("idempotency-key")).toBe(false);
			return image();
		},
	});
	const result = await gateway.fetchResource({ pictureUrl: h5 }, context);
	expect(result.contentType).toBe("image/png");
	expect(result.body).toEqual(png);
});

for (const [type, body, extension] of [
	["image/png", png, "png"],
	["image/jpeg", jpeg, "jpg"],
	["application/pdf", pdf, "pdf"],
] as const) {
	test(`只读票据支持已验证${type}直接资源和内嵌资源`, async () => {
		let requests = 0;
		const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
			fetcher: async () => {
				requests += 1;
				return image(body, type);
			},
		});
		expect(
			(
				await gateway.fetchResource(
					{ pictureUrl: `${origin}/medical-web/ticket.${extension}` },
					context,
				)
			).body,
		).toEqual(body);
		expect(
			(
				await gateway.fetchResource(
					{
						pictureUrl: `data:${type};base64,${Buffer.from(body).toString("base64")}`,
					},
					context,
				)
			).body,
		).toEqual(body);
		expect(requests).toBe(1);
	});
}

test("H5仅提取明确同源静态资源，忽略script内容并且不执行", async () => {
	const requests: string[] = [];
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		fetcher: async (url) => {
			requests.push(String(url));
			if (requests.length === 1) {
				return new Response(
					'<script>"<img src="http://evil.test/track.png">"</script><iframe src="/medical-web/invoice.pdf?ciphertext=aa"></iframe>',
					{ headers: { "content-type": "text/html;charset=utf-8" } },
				);
			}
			return image(pdf, "application/pdf");
		},
	});
	const result = await gateway.fetchResource({ pictureUrl: h5 }, context);
	expect(result.contentType).toBe("application/pdf");
	expect(requests).toEqual([
		h5,
		`${origin}/medical-web/invoice.pdf?ciphertext=aa`,
	]);
});

test("H5可返回经magic核验的内嵌票据，不再发出第二次请求", async () => {
	let requests = 0;
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		fetcher: async () => {
			requests += 1;
			return new Response(
				`<img src="data:image/png;base64,${Buffer.from(png).toString("base64")}">`,
				{ headers: { "content-type": "text/html" } },
			);
		},
	});
	expect(
		(await gateway.fetchResource({ pictureUrl: h5 }, context)).body,
	).toEqual(png);
	expect(requests).toBe(1);
});

for (const url of [
	"http://127.0.0.1/medical-web/invoice.png",
	"http://169.254.169.254/latest/meta-data",
	"file:///medical-web/invoice.png",
	"http://111.111.111.52:18004/medical-web/invoice.png",
	"http://user:pass@111.111.111.52:18003/medical-web/invoice.png",
	`${origin}/medical-web/invoice.png#fragment`,
	`${origin}/medical-web/%2e%2e/secrets.png`,
	`${origin}/medical-web/industryMain.do?method=delete&ciphertext=aa`,
	`${h5}&url=http://127.0.0.1/`,
	`${h5}&ciphertext=bb`,
	`${origin}/medical-web/invoice.svg`,
	`${origin}/medical-web/invoice.png?url=http://127.0.0.1/`,
	`${origin}/medical-web/industryMain.do?method=displayH5&ciphertext=not-hex`,
]) {
	test(`无效票据地址在网络请求前阻断: ${url}`, async () => {
		let requests = 0;
		const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
			fetcher: async () => {
				requests += 1;
				return image();
			},
		});
		await expect(
			gateway.fetchResource({ pictureUrl: url }, context),
		).rejects.toMatchObject({
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
		expect(requests).toBe(0);
	});
}

for (const html of [
	'<script>location.href="/medical-web/a.pdf"</script>',
	'<img src="/medical-web/a.png"><img src="/medical-web/b.png">',
	'<img data-src="/medical-web/a.png">',
	'<img src="data:image/svg+xml;base64,PHN2Zz4=">',
]) {
	test("不能静态确定票据资源时明确unsupported，不运行JS或伪造票据", async () => {
		let requests = 0;
		const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
			fetcher: async () => {
				requests += 1;
				return new Response(html, { headers: { "content-type": "text/html" } });
			},
		});
		await expect(
			gateway.fetchResource({ pictureUrl: h5 }, context),
		).rejects.toBeInstanceOf(ProviderRequestError);
		expect(requests).toBe(1);
	});
}

test("H5外链不发出请求，即便额外origin被配置也不能跨出当前票据源", async () => {
	let requests = 0;
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		allowedOrigins: [origin, "https://files.example.test"],
		fetcher: async () => {
			requests += 1;
			return new Response(
				'<embed src="https://files.example.test/medical-web/invoice.pdf">',
				{ headers: { "content-type": "text/html" } },
			);
		},
	});
	await expect(
		gateway.fetchResource({ pictureUrl: h5 }, context),
	).rejects.toMatchObject({ failureStage: "validation" });
	expect(requests).toBe(1);
});

test("医院302重定向拒绝且不跟随后续地址", async () => {
	let requests = 0;
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		fetcher: async () => {
			requests += 1;
			return new Response(null, {
				status: 302,
				headers: { location: "http://127.0.0.1/" },
			});
		},
	});
	await expect(
		gateway.fetchResource({ pictureUrl: h5 }, context),
	).rejects.toMatchObject({ failureStage: "http", statusCode: 302 });
	expect(requests).toBe(1);
});

for (const response of [
	() => image(png, "application/pdf"),
	() =>
		image(
			new TextEncoder().encode("<html>not a PDF</html>"),
			"application/pdf",
		),
	() => image(png, "image/svg+xml"),
	() => new Response(null, { headers: { "content-type": "image/png" } }),
	() =>
		new Response(png, {
			headers: {
				"content-type": "image/png",
				"content-length": String(8 * 1024 * 1024 + 1),
			},
		}),
	() =>
		new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
					controller.close();
				},
			}),
			{ headers: { "content-type": "image/png" } },
		),
]) {
	test("拒绝伪造类型、空内容和超限流", async () => {
		const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
			fetcher: async () => response(),
		});
		await expect(
			gateway.fetchResource({ pictureUrl: h5 }, context),
		).rejects.toMatchObject({ responseInvalid: true });
	});
}

test("票据请求遵守上下文超时并映射现有Provider transport错误", async () => {
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		fetcher: async (_url, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("aborted", "AbortError")),
					{ once: true },
				);
			}),
	});
	await expect(
		gateway.fetchResource({ pictureUrl: h5 }, { ...context, timeoutMs: 5 }),
	).rejects.toMatchObject({ failureStage: "transport", retryable: true });
});

test("无医院资源明确unsupported", async () => {
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		fetcher: async () => {
			throw new Error("must not fetch");
		},
	});
	await expect(
		gateway.fetchResource({ pictureNetUrl: "-1" }, context),
	).rejects.toMatchObject({
		providerErrorCode: "INVOICE_RESOURCE_UNSUPPORTED",
		responseInvalid: true,
	});
});

test("已验证票据资源可以经固定中转下载原始字节，不附医院或平台鉴权", async () => {
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		relayBaseUrl: "https://gpsrmyy.meiyi.pro/",
		fetcher: async (value, init) => {
			const url = new URL(String(value));
			expect(url.origin).toBe("https://gpsrmyy.meiyi.pro");
			expect(url.pathname).toBe("/proxy/forward");
			expect(url.searchParams.get("url")).toBe(h5);
			expect(url.searchParams.get("download")).toBe("false");
			expect(new Headers(init?.headers).has("authorization")).toBe(false);
			expect(new Headers(init?.headers).has("cookie")).toBe(false);
			return image(pdf, "application/pdf");
		},
	});
	expect(
		(await gateway.fetchResource({ pictureUrl: h5 }, context)).body,
	).toEqual(pdf);
});

for (const relay of [
	"http://gpsrmyy.meiyi.pro",
	"https://other.test",
	"https://gpsrmyy.meiyi.pro/other",
	"https://user:pass@gpsrmyy.meiyi.pro",
	"https://gpsrmyy.meiyi.pro/?url=other",
]) {
	test("中转配置不能转向其他来源或接受调用方URL", () => {
		expect(() =>
			createZhongyangOutpatientElectronicInvoiceResourceGateway({
				relayBaseUrl: relay,
			}),
		).toThrow(AdapterNotConfiguredError);
	});
}

test("自定义中转fetcher即便忽略signal也受到总截止时间约束", async () => {
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		fetcher: async () => new Promise<Response>(() => {}),
	});
	await expect(
		gateway.fetchResource({ pictureUrl: h5 }, { ...context, timeoutMs: 5 }),
	).rejects.toMatchObject({
		failureStage: "transport",
		requestOutcome: "unknown",
	});
});

test("票据流停滞也受到同一次查看的总截止时间约束", async () => {
	const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
		fetcher: async () =>
			new Response(
				new ReadableStream({
					pull() {
						return new Promise(() => {});
					},
				}),
				{ headers: { "content-type": "image/png" } },
			),
	});
	await expect(
		gateway.fetchResource({ pictureUrl: h5 }, { ...context, timeoutMs: 5 }),
	).rejects.toMatchObject({ failureStage: "transport" });
});

for (const condition of [
	"declared-size",
	"stream-size",
	"http",
	"timeout",
] as const) {
	test(`流cancel永不返回也不能阻塞原有错误或超时: ${condition}`, async () => {
		let cancelCount = 0;
		const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
			fetcher: async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							if (condition === "stream-size")
								controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
						},
						cancel() {
							cancelCount += 1;
							return new Promise<void>(() => {});
						},
					}),
					{
						status: condition === "http" ? 503 : 200,
						headers: {
							"content-type": "image/png",
							...(condition === "declared-size"
								? { "content-length": String(8 * 1024 * 1024 + 1) }
								: {}),
						},
					},
				),
		});
		await expect(
			gateway.fetchResource({ pictureUrl: h5 }, { ...context, timeoutMs: 5 }),
		).rejects.toMatchObject({
			failureStage:
				condition === "http"
					? "http"
					: condition === "timeout"
						? "transport"
						: "response",
		});
		expect(cancelCount).toBe(1);
	}, 1000);
}

for (const cancellation of ["sync-throw", "reject"] as const) {
	test(`流清理${cancellation}不覆盖原始HTTP错误`, async () => {
		const response = new Response(new ReadableStream(), { status: 503 });
		if (!response.body) throw new Error("test body missing");
		Object.defineProperty(response.body, "cancel", {
			value: () => {
				if (cancellation === "sync-throw") throw new Error("cleanup failure");
				return Promise.reject(new Error("cleanup failure"));
			},
		});
		const gateway = createZhongyangOutpatientElectronicInvoiceResourceGateway({
			fetcher: async () => response,
		});
		await expect(
			gateway.fetchResource({ pictureUrl: h5 }, context),
		).rejects.toMatchObject({ failureStage: "http", statusCode: 503 });
	});
}
