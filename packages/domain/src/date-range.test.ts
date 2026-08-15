import { expect, test } from "bun:test";
import { parseIsoCalendarDate } from "./date-range";

test("strict ISO date parsing rejects calendar overflow", () => {
	expect(parseIsoCalendarDate("2026-02-28")).toBe(
		Date.parse("2026-02-28T00:00:00.000Z"),
	);
	expect(parseIsoCalendarDate("2026-02-30")).toBeUndefined();
	expect(parseIsoCalendarDate("2026-13-01")).toBeUndefined();
	expect(parseIsoCalendarDate("2026/02/28")).toBeUndefined();
});
