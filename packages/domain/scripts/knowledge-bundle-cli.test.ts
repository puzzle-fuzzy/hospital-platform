import { describe, expect, test } from "bun:test";
import { normalizeHealthKnowledgeBundleCliArguments } from "./knowledge-bundle-cli";

describe("健康知识 bundle CLI 参数边界", () => {
	test("接受 pnpm 转发的一次命令分隔符", () => {
		expect(
			normalizeHealthKnowledgeBundleCliArguments(["--", "bundle.json"]),
		).toEqual({ inputPath: "bundle.json", extraArguments: [] });
	});

	test("直接通过 Bun 调用时保留第一个文件参数", () => {
		expect(normalizeHealthKnowledgeBundleCliArguments(["bundle.json"])).toEqual(
			{ inputPath: "bundle.json", extraArguments: [] },
		);
	});

	test("第二个分隔符不会被静默吞掉", () => {
		expect(
			normalizeHealthKnowledgeBundleCliArguments(["--", "bundle.json", "--"]),
		).toEqual({ inputPath: "bundle.json", extraArguments: ["--"] });
	});
});
