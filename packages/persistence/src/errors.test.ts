import { expect, test } from "bun:test";
import {
	isTransientPersistenceError,
	PersistenceUnavailableError,
	safePersistenceErrorCode,
} from "./errors";

test("持久化瞬态错误码兼容驱动包装层的大小写和连接符差异", () => {
	const variants = [
		"PROTOCOL_CONNECTION_LOST",
		"protocol-connection-lost",
		"Protocol_Connection_Lost",
	];

	for (const code of variants) {
		const cause = Object.assign(new Error("连接细节不能进入日志"), { code });
		expect(isTransientPersistenceError(cause)).toBe(true);
		expect(safePersistenceErrorCode(cause)).toBe("PROTOCOL_CONNECTION_LOST");
		expect(new PersistenceUnavailableError("read", cause).errorCode).toBe(
			"PROTOCOL_CONNECTION_LOST",
		);
	}
});

test("未知持久化错误码不因包含关键词而被放行", () => {
	const cause = Object.assign(new Error("敏感错误"), {
		code: "protocol-connection-lost;host=db.internal",
	});

	expect(isTransientPersistenceError(cause)).toBe(false);
	expect(safePersistenceErrorCode(cause)).toBeUndefined();
});
