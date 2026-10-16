import { expect, test } from "bun:test";
import {
	parseJsonPreservingLargeIntegers,
	stringifyJsonPreservingLargeIntegers,
} from "./lossless-json";

test("19 位 Long 在嵌套结构和数组内无损解析并输出数字", () => {
	const raw =
		'{"thirdPartPayRecordId":9223372036854775807,"nested":[9007199254740993,-9223372036854775808],"safe":9007199254740991,"text":"9223372036854775807"}';
	const parsed = parseJsonPreservingLargeIntegers(raw);
	expect(parsed).toEqual({
		thirdPartPayRecordId: 9223372036854775807n,
		nested: [9007199254740993n, -9223372036854775808n],
		safe: Number.MAX_SAFE_INTEGER,
		text: "9223372036854775807",
	});
	expect(stringifyJsonPreservingLargeIntegers(parsed)).toBe(raw);
});

test("普通 JSON 保留字符串、安全整数、小数、布尔及空值", () => {
	const raw = '{"items":[1,1.5,true,false,null,"123",0]}';
	expect(
		stringifyJsonPreservingLargeIntegers(parseJsonPreservingLargeIntegers(raw)),
	).toBe(raw);
	expect(parseJsonPreservingLargeIntegers("1e3")).toBe(1000);
	expect(parseJsonPreservingLargeIntegers("-0")).toBe(-0);
});

test("拒绝无法无损保留的超安全范围小数和指数", () => {
	for (const raw of [
		"9007199254740993.1",
		"9007199254740991.1",
		"9007199254740991e0",
		"9.223372036854775807e18",
		"1e400",
	]) {
		expect(() => parseJsonPreservingLargeIntegers(raw)).toThrow(SyntaxError);
	}
	expect(() => parseJsonPreservingLargeIntegers('{"id":01}')).toThrow();
});

test("序列化不接受已经舍入的 number 和不可表示的数值", () => {
	for (const value of [
		Number.MAX_SAFE_INTEGER + 1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	]) {
		expect(() => stringifyJsonPreservingLargeIntegers({ value })).toThrow(
			TypeError,
		);
	}
	expect(() => stringifyJsonPreservingLargeIntegers(undefined)).toThrow(
		TypeError,
	);
});
