import { expect, test } from "bun:test";
import type { MySqlRepositories } from "@hospital/persistence";
import { selectReadyRepositories } from "./application";

const repositories = {} as MySqlRepositories;

test("API only installs production repositories after the schema probe passes", () => {
	expect(selectReadyRepositories(repositories, "ok")).toBe(repositories);
	expect(selectReadyRepositories(repositories, "unavailable")).toBeUndefined();
	expect(
		selectReadyRepositories(repositories, "not_configured"),
	).toBeUndefined();
	expect(selectReadyRepositories(undefined, "ok")).toBeUndefined();
});
