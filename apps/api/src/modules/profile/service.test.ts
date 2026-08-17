import { expect, test } from "bun:test";
import { createInMemoryUserProfileRepository } from "@hospital/persistence";
import { createLogger } from "@hospital/observability";
import {
	UserProfileInputError,
	UserProfileVersionConflictError,
} from "@hospital/domain";
import { UserProfileService } from "./service";

test("普通资料不存在时返回默认值且不产生持久化副作用", async () => {
	const repository = createInMemoryUserProfileRepository();
	const service = new UserProfileService(repository);

	await expect(service.get("profile-user-001")).resolves.toEqual({
		displayName: "微信用户",
		gender: "unknown",
		age: null,
		email: null,
		version: 0,
	});
	await expect(
		repository.findByUserId("profile-user-001"),
	).resolves.toBeUndefined();
});

test("普通资料更新会归一化字段并只记录低敏事件元数据", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "profile-test",
		environment: "test",
		destination: { write: (chunk: string) => lines.push(chunk) },
	});
	const service = new UserProfileService(
		createInMemoryUserProfileRepository(),
		{
			logger,
		},
	);

	await expect(
		service.update(
			"profile-user-002",
			{
				version: 0,
				displayName: "  张三  ",
				gender: "male",
				age: 28,
				email: "  user@example.com  ",
			},
			{ traceId: "profile-trace-001", idempotencyKey: "profile-key-001" },
		),
	).resolves.toMatchObject({
		displayName: "张三",
		email: "user@example.com",
		version: 1,
	});

	const line = lines.join("");
	expect(line).toContain('"event":"user.profile.updated"');
	expect(line).toContain('"traceId":"profile-trace-001"');
	expect(line).toContain('"fieldCount":4');
	expect(line).not.toContain("张三");
	expect(line).not.toContain("user@example.com");
});

test("普通资料服务拒绝空值更新和不合法邮箱", async () => {
	const service = new UserProfileService(createInMemoryUserProfileRepository());

	await expect(
		service.update(
			"profile-user-003",
			{ version: 0 },
			{ traceId: "profile-trace-002", idempotencyKey: "profile-key-002" },
		),
	).rejects.toBeInstanceOf(UserProfileInputError);
	await expect(
		service.update(
			"profile-user-003",
			{ version: 0, email: "not-an-email" },
			{ traceId: "profile-trace-003", idempotencyKey: "profile-key-003" },
		),
	).rejects.toBeInstanceOf(UserProfileInputError);
	await expect(
		service.update(
			"profile-user-003",
			{ version: -1, displayName: "测试" },
			{ traceId: "profile-trace-004", idempotencyKey: "profile-key-004" },
		),
	).rejects.toBeInstanceOf(UserProfileInputError);
});

test("普通资料版本冲突保留 409 语义并记录低敏 trace 事件", async () => {
	const lines: string[] = [];
	const service = new UserProfileService(
		createInMemoryUserProfileRepository(),
		{
			logger: createLogger({
				service: "profile-test",
				environment: "test",
				destination: { write: (chunk: string) => lines.push(chunk) },
			}),
		},
	);

	await service.update(
		"profile-user-004",
		{ version: 0, displayName: "首次资料" },
		{ traceId: "profile-trace-004", idempotencyKey: "profile-key-004" },
	);
	await expect(
		service.update(
			"profile-user-004",
			{ version: 0, displayName: "旧设备资料" },
			{ traceId: "profile-conflict-trace", idempotencyKey: "profile-key-005" },
		),
	).rejects.toBeInstanceOf(UserProfileVersionConflictError);

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	const conflict = records.find(
		(record) => record.event === "user.profile.conflict",
	);
	expect(conflict).toMatchObject({
		event: "user.profile.conflict",
		traceId: "profile-conflict-trace",
		errorType: "UserProfileVersionConflictError",
	});
	expect(JSON.stringify(conflict)).not.toContain("profile-user-004");
	expect(JSON.stringify(conflict)).not.toContain("旧设备资料");
});
