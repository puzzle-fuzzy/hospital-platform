import { expect, test } from "bun:test";
import { formatAdminTime } from "./admin-time";

test("UTC 与带北京时间偏移的同一时刻只转换一次", () => {
	expect(formatAdminTime("2026-10-15T07:40:31.000Z")).toBe(
		"2026/10/15 15:40:31",
	);
	expect(formatAdminTime("2026-10-15T15:40:31.000+08:00")).toBe(
		"2026/10/15 15:40:31",
	);
});

test("UTC 日期跨北京时间午夜时显示正确自然日和00点", () => {
	expect(formatAdminTime("2026-10-15T15:59:59.000Z")).toBe(
		"2026/10/15 23:59:59",
	);
	expect(formatAdminTime("2026-10-15T16:00:00.000Z")).toBe(
		"2026/10/16 00:00:00",
	);
	expect(formatAdminTime("2026-12-31T16:00:00.000Z")).toBe(
		"2027/01/01 00:00:00",
	);
});

test.each(["UTC", "America/Los_Angeles", "Asia/Tokyo"])(
	"运行环境时区为%s时仍显示北京时间",
	(zone) => {
		const moduleUrl = new URL("./admin-time.ts", import.meta.url).href;
		const result = Bun.spawnSync(
			[
				process.execPath,
				"-e",
				`import { formatAdminTime } from ${JSON.stringify(moduleUrl)}; console.log(formatAdminTime("2026-10-15T16:05:00.000Z"));`,
			],
			{ env: { ...process.env, TZ: zone }, stdout: "pipe", stderr: "pipe" },
		);
		expect(result.exitCode).toBe(0);
		expect(new TextDecoder().decode(result.stdout).trim()).toBe(
			"2026/10/16 00:05:00",
		);
	},
);

test("无时区的数据库字符串和无效时间保持待核实，不猜时区", () => {
	for (const value of [
		"2026-10-15 15:40:31.000",
		"2026-10-15T15:40:31.000",
		"not-a-timestamp",
		"2026-13-15T15:40:31.000Z",
	]) {
		expect(formatAdminTime(value)).toBe("时间待核实");
	}
});
