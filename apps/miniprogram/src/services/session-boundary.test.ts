import { expect, test } from "bun:test";
import { ApiError } from "./api-client";
import { assertSessionGeneration } from "./session-boundary";
import {
	advanceSessionGeneration,
	getSessionGeneration,
} from "./session-generation";

test("页面组合读取在会话代际变化后必须 fail-closed", () => {
	const expectedGeneration = getSessionGeneration();

	expect(() =>
		assertSessionGeneration(expectedGeneration, "same session"),
	).not.toThrow();

	advanceSessionGeneration();

	try {
		assertSessionGeneration(expectedGeneration, "session changed");
		throw new Error("expected session boundary to reject stale generation");
	} catch (error) {
		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).code).toBe("session-changed");
	}
});
