import { expect, test } from "bun:test";
import {
	MAX_USER_PROFILE_VERSION,
	UserProfileInputError,
	UserProfileReadModelValidationError,
	UserProfileVersionConflictError,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createInMemoryUserProfileRepository } from "@hospital/persistence";
import { UserProfileService } from "./service";

test("普通资料不存在时返回默认值且不产生持久化副作用", async () => {
	const lines: string[] = [];
	const repository = createInMemoryUserProfileRepository();
	const service = new UserProfileService(repository, {
		logger: createLogger({
			service: "profile-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});
	const context = {
		traceId: "profile-read-trace-001",
		idempotencyKey: "profile-read-trace-001",
	};

	await expect(service.get("profile-user-001", context)).resolves.toEqual({
		displayName: "微信用户",
		gender: "unknown",
		age: null,
		email: null,
		version: 0,
	});
	await expect(
		repository.findByUserId("profile-user-001"),
	).resolves.toBeUndefined();
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"user.profile.requested",
		"user.profile.loaded",
	]);
	expect(records[1]).toMatchObject({
		traceId: "profile-read-trace-001",
		persisted: false,
	});
	expect(JSON.stringify(records)).not.toContain("profile-user-001");
});

test("普通资料读取失败记录安全事件而不泄露底层错误", async () => {
	const lines: string[] = [];
	const service = new UserProfileService(
		{
			findByUserId: async () => {
				throw new Error("mysql password=secret connection failed");
			},
			update: async () => {
				throw new Error("not used");
			},
		},
		{
			logger: createLogger({
				service: "profile-test",
				environment: "test",
				destination: { write: (chunk: string) => lines.push(chunk) },
			}),
		},
	);

	await expect(
		service.get("profile-user-read-failure", {
			traceId: "profile-read-trace-002",
			idempotencyKey: "profile-read-trace-002",
		}),
	).rejects.toThrow("mysql password=secret connection failed");

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"user.profile.requested",
		"user.profile.read_failed",
	]);
	expect(records[1]).toMatchObject({
		traceId: "profile-read-trace-002",
		errorType: "Error",
	});
	expect(JSON.stringify(records)).not.toContain("password=secret");
});

test("普通资料损坏读模型不会记录 loaded 成功或降级成默认资料", async () => {
	const lines: string[] = [];
	const service = new UserProfileService(
		{
			findByUserId: async () => ({
				userId: "profile-corrupt-001",
				displayName: "坏\n资料",
				gender: "unknown",
				age: null,
				email: null,
				version: 1,
			}),
			update: async () => {
				throw new Error("not used");
			},
		},
		{
			logger: createLogger({
				service: "profile-test",
				environment: "test",
				destination: { write: (chunk: string) => lines.push(chunk) },
			}),
		},
	);

	await expect(
		service.get("profile-corrupt-001", {
			traceId: "profile-corrupt-trace",
			idempotencyKey: "profile-corrupt-key",
		}),
	).rejects.toMatchObject({
		name: "UserProfileReadModelValidationError",
		violation: "profile-display-name-invalid",
	});

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.some((record) => record.event === "user.profile.loaded")).toBe(
		false,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "user.profile.read_failed",
			readModelViolation: "profile-display-name-invalid",
		}),
	);
	expect(JSON.stringify(records)).not.toContain("坏");
});

test("普通资料更新返回损坏读模型时不记录 updated 成功", async () => {
	const lines: string[] = [];
	const service = new UserProfileService(
		{
			findByUserId: async () => undefined,
			update: async () => ({
				userId: "profile-corrupt-update-001",
				displayName: "正常",
				gender: "unknown",
				age: null,
				email: "bad-email",
				version: 1,
			}),
		},
		{
			logger: createLogger({
				service: "profile-test",
				environment: "test",
				destination: { write: (chunk: string) => lines.push(chunk) },
			}),
		},
	);

	await expect(
		service.update(
			"profile-corrupt-update-001",
			{ version: 0, displayName: "正常" },
			{
				traceId: "profile-corrupt-update-trace",
				idempotencyKey: "profile-corrupt-update-key",
			},
		),
	).rejects.toBeInstanceOf(UserProfileReadModelValidationError);

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(
		records.some((record) => record.event === "user.profile.updated"),
	).toBe(false);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "user.profile.update_failed",
			readModelViolation: "profile-email-invalid",
		}),
	);
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
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"user.profile.update.requested",
		"user.profile.updated",
	]);
	expect(line).toContain('"event":"user.profile.updated"');
	expect(line).toContain('"traceId":"profile-trace-001"');
	expect(line).toContain('"fieldCount":4');
	expect(line).not.toContain("张三");
	expect(line).not.toContain("user@example.com");
});

test("普通资料服务拒绝非法输入并留下安全失败日志", async () => {
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
	await expect(
		service.update(
			"profile-user-003",
			{ version: 0, displayName: "张\n三" },
			{ traceId: "profile-trace-005", idempotencyKey: "profile-key-005" },
		),
	).rejects.toBeInstanceOf(UserProfileInputError);
	await expect(
		service.update(
			"profile-user-003",
			{ version: 0, email: "user\u0000@example.com" },
			{ traceId: "profile-trace-006", idempotencyKey: "profile-key-006" },
		),
	).rejects.toBeInstanceOf(UserProfileInputError);

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"user.profile.update.requested",
		"user.profile.update_failed",
		"user.profile.update.requested",
		"user.profile.update_failed",
		"user.profile.update.requested",
		"user.profile.update_failed",
		"user.profile.update.requested",
		"user.profile.update_failed",
		"user.profile.update.requested",
		"user.profile.update_failed",
	]);
	expect(records[3]).toMatchObject({
		traceId: "profile-trace-003",
		errorType: "UserProfileInputError",
	});
	expect(JSON.stringify(records)).not.toContain("not-an-email");
});

test("普通资料输入校验失败时不会触碰仓储写入", async () => {
	let updateCalls = 0;
	const service = new UserProfileService({
		findByUserId: async () => undefined,
		update: async () => {
			updateCalls += 1;
			throw new Error("update must not run for invalid input");
		},
	});

	// 输入边界必须先于仓储调用执行；否则非法资料可能先写入数据库，
	// 再由后续层返回失败，造成“页面提示失败但数据已经改变”的危险语义。
	await expect(
		service.update(
			"profile-no-write-001",
			{ version: 0, email: "not-an-email" },
			{
				traceId: "profile-no-write-trace",
				idempotencyKey: "profile-no-write-key",
			},
		),
	).rejects.toBeInstanceOf(UserProfileInputError);

	expect(updateCalls).toBe(0);
});

test("清空普通资料字段时日志字段数量仍反映实际修改", async () => {
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
		"profile-user-clear-001",
		{ version: 0, email: "clear@example.com" },
		{
			traceId: "profile-clear-trace-001",
			idempotencyKey: "profile-clear-key-001",
		},
	);
	await service.update(
		"profile-user-clear-001",
		{ version: 1, email: null },
		{
			traceId: "profile-clear-trace-002",
			idempotencyKey: "profile-clear-key-002",
		},
	);

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.at(-1)).toMatchObject({
		event: "user.profile.updated",
		traceId: "profile-clear-trace-002",
		fieldCount: 1,
	});
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

test("普通资料按 Unicode 字符计数，允许 64 个中文或 emoji 字符并拒绝第 65 个", async () => {
	const service = new UserProfileService(createInMemoryUserProfileRepository());

	await expect(
		service.update(
			"profile-unicode-001",
			{ version: 0, displayName: "中".repeat(64) },
			{
				traceId: "profile-unicode-trace-001",
				idempotencyKey: "profile-unicode-key-001",
			},
		),
	).resolves.toMatchObject({ version: 1 });

	await expect(
		service.update(
			"profile-unicode-002",
			{ version: 0, displayName: "😀".repeat(64) },
			{
				traceId: "profile-unicode-trace-002",
				idempotencyKey: "profile-unicode-key-002",
			},
		),
	).resolves.toMatchObject({ version: 1 });

	await expect(
		service.update(
			"profile-unicode-003",
			{ version: 0, displayName: "中".repeat(65) },
			{
				traceId: "profile-unicode-trace-003",
				idempotencyKey: "profile-unicode-key-003",
			},
		),
	).rejects.toBeInstanceOf(UserProfileInputError);
});

test("普通资料拒绝超出 MySQL INT UNSIGNED 的版本", async () => {
	const service = new UserProfileService(createInMemoryUserProfileRepository());

	await expect(
		service.update(
			"profile-version-001",
			{ version: 4_294_967_296, displayName: "版本越界" },
			{
				traceId: "profile-version-trace-001",
				idempotencyKey: "profile-version-key-001",
			},
		),
	).rejects.toBeInstanceOf(UserProfileInputError);
});

test("普通资料版本到达上限时在仓储写入前失败", async () => {
	let updateCalls = 0;
	const service = new UserProfileService({
		findByUserId: async () => undefined,
		update: async () => {
			updateCalls += 1;
			throw new Error("profile update must not run at version limit");
		},
	});

	await expect(
		service.update(
			"profile-version-limit-001",
			{ version: MAX_USER_PROFILE_VERSION, displayName: "最后一次资料" },
			{
				traceId: "profile-version-limit-trace",
				idempotencyKey: "profile-version-limit-key",
			},
		),
	).rejects.toBeInstanceOf(UserProfileInputError);
	// 版本已无法产生合法的下一版本，不能把越界值交给 MySQL 或内存仓储。
	expect(updateCalls).toBe(0);
});
