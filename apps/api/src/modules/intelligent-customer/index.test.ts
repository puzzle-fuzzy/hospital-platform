import { expect, test } from "bun:test";
import type { IntelligentCustomerApplicationService } from "@hospital/domain";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { createInMemorySessionTokenService } from "../auth/service";
import { intelligentCustomerModule } from "./index";
import { InMemoryIntelligentCustomerRateLimiter } from "./rate-limit";

test("客服 HTTP 模块把认证 owner 和文本 contract 交给应用服务", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("customer-user-001");
	let observedOwner = "";
	const service = {
		chatText: async (ownerUserId, input, context) => {
			observedOwner = ownerUserId;
			expect(input).toEqual({ message: "医院怎么预约" });
			expect(context.traceId).toBe("trace-customer-http-001");
			return {
				conversationReference: "customer-reference-001",
				userInput: input.message,
				message: "请通过官方渠道预约。",
				redirect: "",
			};
		},
		chatAudio: async () => {
			throw new Error("audio should not be called");
		},
	} satisfies IntelligentCustomerApplicationService;

	const response = await intelligentCustomerModule(service, sessions).handle(
		new Request("http://localhost/intelligent-customer/messages", {
			method: "POST",
			headers: {
				authorization: `Bearer ${issued.accessToken}`,
				"content-type": "application/json",
				"x-request-id": "trace-customer-http-001",
			},
			body: JSON.stringify({ message: "医院怎么预约" }),
		}),
	);

	expect(response.status).toBe(200);
	expect(observedOwner).toBe("customer-user-001");
	expect(await response.json()).toEqual({
		success: true,
		data: {
			conversationReference: "customer-reference-001",
			userInput: "医院怎么预约",
			message: "请通过官方渠道预约。",
			redirect: "",
		},
	});
});

test("客服 HTTP 音频模块只转交有界文件和会话引用", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("customer-user-002");
	let observedAudio: {
		bytes: number;
		contentType: string;
		reference?: string;
	} = {
		bytes: 0,
		contentType: "",
	};
	const service = {
		chatText: async () => {
			throw new Error("text should not be called");
		},
		chatAudio: async (ownerUserId, input) => {
			expect(ownerUserId).toBe("customer-user-002");
			observedAudio = {
				bytes: input.audio.byteLength,
				contentType: input.contentType,
				...(input.conversationReference
					? { reference: input.conversationReference }
					: {}),
			};
			return {
				conversationReference:
					input.conversationReference ?? "customer-reference-002",
				userInput: "预约挂号",
				message: "请通过官方渠道预约。",
				redirect: "",
			};
		},
	} satisfies IntelligentCustomerApplicationService;

	const form = new FormData();
	form.append(
		"audio",
		new File([new Uint8Array(128)], "voice.mp3", { type: "audio/mpeg" }),
	);
	form.append("conversationReference", "customer-reference-002");
	const response = await intelligentCustomerModule(service, sessions).handle(
		new Request("http://localhost/intelligent-customer/audio", {
			method: "POST",
			headers: { authorization: `Bearer ${issued.accessToken}` },
			body: form,
		}),
	);

	expect(response.status).toBe(200);
	expect(observedAudio).toEqual({
		bytes: 128,
		contentType: "audio/mpeg",
		reference: "customer-reference-002",
	});
});

test("客服 HTTP 文本和音频共享按用户限流器", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("customer-user-rate-limited");
	const service = {
		chatText: async () => ({
			conversationReference: "customer-reference-rate-limited",
			userInput: "医院怎么预约",
			message: "请通过官方渠道预约。",
			redirect: "",
		}),
		chatAudio: async () => {
			throw new Error("audio should not be called");
		},
	} satisfies IntelligentCustomerApplicationService;
	const app = new Elysia().use(errorHandlerPlugin()).use(
		intelligentCustomerModule(service, sessions, {
			rateLimiter: new InMemoryIntelligentCustomerRateLimiter({
				maxRequests: 1,
				windowMs: 60_000,
			}),
		}),
	);
	const request = () =>
		app.handle(
			new Request("http://localhost/intelligent-customer/messages", {
				method: "POST",
				headers: {
					authorization: `Bearer ${issued.accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ message: "医院怎么预约" }),
			}),
		);

	expect((await request()).status).toBe(200);
	const limited = await request();
	expect(limited.status).toBe(429);
	expect(limited.headers.get("retry-after")).toBe("60");
	expect(await limited.json()).toMatchObject({
		error: { code: "intelligent-customer-rate-limited", numericCode: 60440 },
	});
});
