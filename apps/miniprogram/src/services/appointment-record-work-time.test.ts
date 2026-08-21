import { describe, expect, test } from "bun:test";
import { isAppointmentRecordWorkTime as isSharedContractWorkTime } from "@hospital/contracts";
import { isAppointmentRecordWorkTime } from "./appointment-record-work-time";

describe("小程序预约记录时间运行时校验", () => {
	test("与共享契约保持已确认边界一致", () => {
		const cases: unknown[] = [
			"00:00",
			"09:30",
			"23:59",
			"09:30-10:00",
			"09:30-09:30",
			"23:59-00:00",
			"24:00",
			"09:60",
			"9:30",
			"09:30-09:29",
			"上午",
			null,
			undefined,
		];

		for (const value of cases) {
			expect(isAppointmentRecordWorkTime(value)).toBe(
				isSharedContractWorkTime(value),
			);
		}
	});
});
