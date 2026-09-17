import { expect, test } from "bun:test";
import type {
	AppointmentDirectoryGateway,
	IntelligentGuideConversationStateStore,
} from "@hospital/domain";
import { DependencyNotConfiguredError } from "@hospital/domain";
import type { MySqlRepositories } from "@hospital/persistence";
import {
	createDefaultApplicationServices,
	selectReadyRepositories,
} from "./application";
import { NativeIntelligentGuideService } from "./modules/intelligent-guide";

const repositories = {} as MySqlRepositories;

test("API only installs production repositories after the schema probe passes", () => {
	expect(selectReadyRepositories(repositories, "ok")).toBe(repositories);
	expect(selectReadyRepositories(repositories, "unavailable")).toBeUndefined();
	expect(
		selectReadyRepositories(repositories, "not_configured"),
	).toBeUndefined();
	expect(selectReadyRepositories(undefined, "ok")).toBeUndefined();
});

test("default application composition prefers the native TS guide when its ports are ready", () => {
	const directory = {
		async listDepartments() {
			return {
				departments: [],
				trace: { provider: "test", operation: "test", requestId: "test" },
			};
		},
		async listSchedules() {
			return {
				schedules: [],
				trace: { provider: "test", operation: "test", requestId: "test" },
			};
		},
	} satisfies AppointmentDirectoryGateway;
	const conversations = {
		async load() {
			return undefined;
		},
		async save() {},
	} satisfies IntelligentGuideConversationStateStore;

	const services = createDefaultApplicationServices({
		appointmentDirectoryGateway: directory,
		intelligentGuideConversationStates: conversations,
	});

	expect(services.intelligentGuide).toBeInstanceOf(
		NativeIntelligentGuideService,
	);
});

test("default application composition does not revive the legacy guide fallback", () => {
	const services = createDefaultApplicationServices();

	expect(services.intelligentGuide).toBeUndefined();
});

test("closed patient binding does not invoke legacy auth before missing binding gateway", async () => {
	let authCalls = 0;
	const services = createDefaultApplicationServices({
		patientProviderAuthorizationGateway: {
			async exchangeWechatCode() {
				authCalls += 1;
				throw new Error("legacy auth must not run");
			},
		},
	});

	await expect(
		services.patientBinding?.bind(
			"fixture-closed-binding-owner",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: true,
				legacyLoginCode: "wx-code-closed",
			},
			{
				traceId: "closed-binding-trace",
				idempotencyKey: "closed-binding-idem",
			},
		),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
	expect(authCalls).toBe(0);
});
