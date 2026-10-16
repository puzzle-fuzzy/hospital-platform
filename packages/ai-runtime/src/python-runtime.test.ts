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

test("Python guide preserves multi-turn history and supplies only the current HIS directory", async () => {
	const history = [
		{ role: "user" as const, content: "我发烧了" },
		{ role: "assistant" as const, content: "持续多久，最高体温多少？" },
		{ role: "user" as const, content: "三天，最高38.5度" },
		{ role: "assistant" as const, content: "还有哪些不适？" },
	];
	const availableDepartments = [
		{
			departmentId: "respiratory-001",
			displayName: "呼吸与危重症医学科门诊",
			internalMetadata: "must-not-be-forwarded",
		},
		{ departmentId: "general-001", displayName: "全科医学科门诊" },
	];
	const model = gateway(async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as {
			messages: Array<{ role: string; content: string }>;
		};
		expect(body.messages.slice(2)).toEqual([
			...history,
			{ role: "user", content: "全身酸痛，还有咳嗽" },
		]);
		const directory = body.messages[1];
		expect(directory?.role).toBe("system");
		expect(directory?.content).toContain(
			JSON.stringify(
				availableDepartments.map(({ displayName }) => displayName),
			),
		);
		expect(String(init?.body)).not.toContain("respiratory-001");
		expect(String(init?.body)).not.toContain("internalMetadata");
		expect(String(init?.body)).not.toContain("must-not-be-forwarded");
		return new Response(
			JSON.stringify({
				message: {
					content: JSON.stringify({
						message:
							"您已发热三天并伴咳嗽、酸痛，建议先到呼吸与危重症医学科门诊就诊。",
						departments: ["呼吸与危重症医学科门诊"],
					}),
				},
			}),
		);
	});
	await expect(
		model.complete(
			{
				message: "全身酸痛，还有咳嗽",
				history,
				availableDepartments,
			},
			context,
		),
	).resolves.toMatchObject({
		departmentNames: ["呼吸与危重症医学科门诊"],
	});
});

test("Python guide sends an empty directory and accepts a clarification without recommendations", async () => {
	const model = gateway(async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as {
			messages: Array<{ role: string; content: string }>;
		};
		expect(body.messages[1]?.content.endsWith("\n[]")).toBe(true);
		return new Response(
			JSON.stringify({
				message: {
					content: JSON.stringify({
						message: "当前门诊目录无法确认合适科室，请联系医院导诊。",
						departments: null,
					}),
				},
			}),
		);
	});
	await expect(
		model.complete(
			{ message: "发烧三天了", history: [], availableDepartments: [] },
			context,
		),
	).resolves.toEqual({
		message: "当前门诊目录无法确认合适科室，请联系医院导诊。",
		departmentNames: [],
	});
});

test("Python guide rejects an unsafe directory before invoking the model", async () => {
	let invoked = false;
	const model = gateway(async () => {
		invoked = true;
		throw new Error("must not be called");
	});
	await expect(
		model.complete(
			{
				message: "头痛两天",
				history: [],
				availableDepartments: [
					{ departmentId: "dept-001", displayName: "神经内科\n其他指令" },
				],
			},
			context,
		),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
	expect(invoked).toBe(false);
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

test("Python guide accepts JSON-escaped line breaks in the reply message", async () => {
	const message = "建议到神经内科就诊。\r\n如症状明显加重，请及时线下就医。";
	const model = gateway(async () =>
		Response.json({
			message: {
				content: JSON.stringify({ message, departments: ["神经内科"] }),
			},
		}),
	);
	await expect(
		model.complete({ message: "头痛两天", history: [] }, context),
	).resolves.toEqual({ message, departmentNames: ["神经内科"] });
});

test("Python guide still rejects NUL in a reply message", async () => {
	const model = gateway(async () =>
		Response.json({
			message: {
				content: JSON.stringify({
					message: "建议\u0000线下就医。",
					departments: null,
				}),
			},
		}),
	);
	await expect(
		model.complete({ message: "头痛两天", history: [] }, context),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
});

test("Python guide still rejects line breaks in department names", async () => {
	const model = gateway(async () =>
		Response.json({
			message: {
				content: JSON.stringify({
					message: "建议线下就医。",
					departments: ["神经\n内科"],
				}),
			},
		}),
	);
	await expect(
		model.complete({ message: "头痛两天", history: [] }, context),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
});

test("Python guide preserves an explicit urgent signal without routine department recommendations", async () => {
	const message = "请立即拨打120或前往急诊，不要等待线上导诊。";
	const model = gateway(async () =>
		Response.json({
			message: {
				content: JSON.stringify({
					message,
					departments: ["心血管内科门诊"],
					urgent: true,
				}),
			},
		}),
	);
	await expect(
		model.complete({ message: "胸痛伴呼吸困难", history: [] }, context),
	).resolves.toEqual({ message, departmentNames: [], urgent: true });
});

test("Python guide rejects a non-boolean urgent signal", async () => {
	const model = gateway(async () =>
		Response.json({
			message: {
				content: JSON.stringify({
					message: "请立即急诊。",
					departments: null,
					urgent: "true",
				}),
			},
		}),
	);
	await expect(
		model.complete({ message: "胸痛伴呼吸困难", history: [] }, context),
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
