import { expect, test } from "bun:test";
import { parseIsoCalendarDate, parseStrictIsoInstant } from "./date-range";

test("strict ISO date parsing rejects calendar overflow", () => {
	expect(parseIsoCalendarDate("2026-02-28")).toBe(
		Date.parse("2026-02-28T00:00:00.000Z"),
	);
	expect(parseIsoCalendarDate("2026-02-30")).toBeUndefined();
	expect(parseIsoCalendarDate("2026-13-01")).toBeUndefined();
	expect(parseIsoCalendarDate("2026/02/28")).toBeUndefined();
});

test("strict ISO timestamp parsing rejects calendar and clock overflow", () => {
	const valid = "2026-02-28T23:59:59.123Z";
	expect(parseStrictIsoInstant(valid)).toBe(Date.parse(valid));
	expect(parseStrictIsoInstant("2026-02-30T00:00:00.000Z")).toBeUndefined();
	expect(parseStrictIsoInstant("2026-02-28T24:00:00.000Z")).toBeUndefined();
	expect(parseStrictIsoInstant("2026-02-28T00:00:00.000")).toBeUndefined();
	expect(parseStrictIsoInstant("2026-02-28T00:00:00+08:00")).toBe(
		Date.parse("2026-02-28T00:00:00+08:00"),
	);
});
