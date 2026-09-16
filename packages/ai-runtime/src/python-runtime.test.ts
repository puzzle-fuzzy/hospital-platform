import { expect, test } from "bun:test";
import { DependencyNotConfiguredError } from "@hospital/domain";
import {
	type PythonAiRuntimeFetcher,
	PythonLocalAiCustomerModelGateway,
	PythonLocalAiKnowledgeSearchGateway,
	PythonLocalAiModelGateway,
	PythonLocalAiSpeechGateway,
} from "./python-runtime";

const context = {
	traceId: "trace-python-runtime-001",
	idempotencyKey: "python-runtime-001",
};

function gateway(fetcher: PythonAiRuntimeFetcher) {
	return new PythonLocalAiModelGateway({
		baseUrl: "http://127.0.0.1:8101",
		token: "local-ai-runtime-token-000001",
		fetcher,
	});
}

function speechGateway(fetcher: PythonAiRuntimeFetcher) {
	return new PythonLocalAiSpeechGateway({
		baseUrl: "http://127.0.0.1:8101",
		token: "local-ai-runtime-token-000001",
		fetcher,
	});
}

function searchGateway(fetcher: PythonAiRuntimeFetcher) {
	return new PythonLocalAiKnowledgeSearchGateway({
		baseUrl: "http://127.0.0.1:8101",
		token: "local-ai-runtime-token-000001",
		fetcher,
	});
}

function customerGateway(fetcher: PythonAiRuntimeFetcher) {
	return new PythonLocalAiCustomerModelGateway({
		baseUrl: "http://127.0.0.1:8101",
		token: "local-ai-runtime-token-000001",
		fetcher,
	});
}

test("Python runtime gateway sends the guide task and normalizes JSON output", async () => {
	const model = gateway(async (input, init) => {
		expect(String(input)).toBe("http://127.0.0.1:8101/chat");
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer local-ai-runtime-token-000001",
			"x-request-id": "trace-python-runtime-001",
		});
		const body = JSON.parse(String(init?.body)) as {
			task: string;
			messages: Array<{ role: string; content: string }>;
		};
		expect(body.task).toBe("guide");
		expect(body.messages.at(-1)).toEqual({ role: "user", content: "头痛两天" });
		return new Response(
			JSON.stringify({
				message: {
					role: "assistant",
					content: JSON.stringify({
						message: "建议优先选择相关科室",
						departments: ["神经内科"],
					}),
				},
			}),
			{ status: 200 },
		);
	});

	await expect(
		model.complete(
			{
				message: "头痛两天",
				history: [{ role: "assistant", content: "请补充症状" }],
			},
			context,
		),
	).resolves.toEqual({
		message: "建议优先选择相关科室",
		departmentNames: ["神经内科"],
	});
});

test("Python runtime gateway fails closed on malformed model output", async () => {
	const model = gateway(
		async () =>
			new Response(JSON.stringify({ message: { content: "not-json" } }), {
				status: 200,
			}),
	);

	await expect(
		model.complete({ message: "头痛", history: [] }, context),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
});

test("Python runtime gateway rejects non-loopback endpoints", () => {
	expect(
		() =>
			new PythonLocalAiModelGateway({
				baseUrl: "http://ai.internal:8101",
				token: "local-ai-runtime-token-000001",
			}),
	).toThrow(DependencyNotConfiguredError);
});

test("Python speech gateway uploads bounded audio and normalizes transcription", async () => {
	const speech = speechGateway(async (input, init) => {
		expect(String(input)).toBe("http://127.0.0.1:8101/speech/transcribe");
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer local-ai-runtime-token-000001",
			"x-request-id": "trace-python-runtime-001",
		});
		const body = init?.body;
		expect(body).toBeInstanceOf(FormData);
		const upload = (body as FormData).get("audio");
		expect(upload).toBeInstanceOf(Blob);
		expect((upload as Blob).type).toBe("audio/mpeg");
		expect((upload as Blob).size).toBe(128);
		return new Response(
			JSON.stringify({ code: 0, data: { text: "  头痛两天  " } }),
			{ status: 200 },
		);
	});

	await expect(
		speech.transcribe(
			{ audio: new Uint8Array(128), contentType: "audio/mpeg" },
			context,
		),
	).resolves.toEqual({ text: "头痛两天" });
});

test("Python knowledge search gateway normalizes approved document chunks", async () => {
	const search = searchGateway(async (input, init) => {
		expect(String(input)).toBe("http://127.0.0.1:8101/search");
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer local-ai-runtime-token-000001",
			"Content-Type": "application/json",
			"x-request-id": "trace-python-runtime-001",
		});
		expect(JSON.parse(String(init?.body))).toEqual({ query: "如何预约挂号" });
		return new Response(
			JSON.stringify({
				matches: [
					{
						document_id: "hospital-guide",
						title: "医院指南",
						source: "审核资料",
						chunk: 0,
						content: "请通过官方渠道预约挂号",
						score: 1.25,
					},
				],
			}),
			{ status: 200 },
		);
	});

	await expect(search.search("如何预约挂号", context)).resolves.toEqual({
		matches: [
			{
				documentId: "hospital-guide",
				title: "医院指南",
				source: "审核资料",
				chunk: 0,
				content: "请通过官方渠道预约挂号",
				score: 1.25,
			},
		],
	});
});

test("Python knowledge search gateway fails closed on malformed search results", async () => {
	const search = searchGateway(
		async () =>
			new Response(
				JSON.stringify({
					matches: [
						{
							document_id: "hospital-guide",
							title: "医院指南",
							source: "审核资料",
							chunk: -1,
							content: "不应被接受",
							score: 1,
						},
					],
				}),
				{ status: 200 },
			),
	);

	await expect(search.search("如何预约挂号", context)).rejects.toBeInstanceOf(
		DependencyNotConfiguredError,
	);
});

test("Python customer gateway sends isolated customer task with transient knowledge", async () => {
	const customer = customerGateway(async (input, init) => {
		expect(String(input)).toBe("http://127.0.0.1:8101/chat");
		const body = JSON.parse(String(init?.body)) as {
			task: string;
			messages: Array<{ role: string; content: string }>;
		};
		expect(body.task).toBe("customer");
		expect(body.messages[0]?.role).toBe("system");
		expect(body.messages[1]?.content).toContain("<knowledge>");
		expect(body.messages.at(-1)).toEqual({
			role: "user",
			content: "医院怎么预约挂号",
		});
		return new Response(
			JSON.stringify({
				message: {
					role: "assistant",
					content: JSON.stringify({
						message: "请通过医院官方渠道预约挂号。",
						redirect: "",
					}),
				},
			}),
			{ status: 200 },
		);
	});

	await expect(
		customer.complete(
			{
				message: "医院怎么预约挂号",
				history: [],
				knowledge: [
					{
						documentId: "hospital-guide",
						title: "医院指南",
						source: "审核资料",
						chunk: 0,
						content: "请通过官方渠道预约挂号",
						score: 1,
					},
				],
			},
			context,
		),
	).resolves.toEqual({
		message: "请通过医院官方渠道预约挂号。",
		redirect: "",
	});
});

test("Python customer gateway rejects an unsupported redirect intent", async () => {
	const customer = customerGateway(
		async () =>
			new Response(
				JSON.stringify({
					message: {
						content: JSON.stringify({
							message: "请联系医院核实。",
							redirect: "registration",
						}),
					},
				}),
				{ status: 200 },
			),
	);

	await expect(
		customer.complete(
			{ message: "怎么预约", history: [], knowledge: [] },
			context,
		),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
});
