type JsonParseContext = { source?: string };

type JsonWithSource = {
	parse(
		text: string,
		reviver: (
			key: string,
			value: unknown,
			context?: JsonParseContext,
		) => unknown,
	): unknown;
	rawJSON(text: string): unknown;
};

const losslessJson = JSON as unknown as JsonWithSource;
const JSON_INTEGER = /^-?(?:0|[1-9]\d*)$/;

/**
 * 仅在需要无损交换 Long 的边界使用。保留整数原始 token，避免 JSON.parse
 * 先把 19 位编号舍入后再转字符串；普通安全整数仍保持 number。
 */
export function parseJsonPreservingLargeIntegers(text: string): unknown {
	return losslessJson.parse(text, (_key, value, context) => {
		if (typeof value !== "number") return value;
		if (context?.source && JSON_INTEGER.test(context.source)) {
			if (Number.isSafeInteger(value)) return value;
			return BigInt(context.source);
		}
		if (!Number.isFinite(value) || Math.abs(value) >= Number.MAX_SAFE_INTEGER) {
			throw new SyntaxError("Unsafe JSON number requires an integer literal");
		}
		return value;
	});
}

/** bigint 以 JSON 数字输出，不能加引号，也不能先转换为 number。 */
export function stringifyJsonPreservingLargeIntegers(value: unknown): string {
	const result = JSON.stringify(value, (_key, nestedValue: unknown) => {
		if (typeof nestedValue === "bigint") {
			return losslessJson.rawJSON(nestedValue.toString());
		}
		if (
			typeof nestedValue === "number" &&
			(!Number.isFinite(nestedValue) ||
				(Number.isInteger(nestedValue) && !Number.isSafeInteger(nestedValue)))
		) {
			throw new TypeError("Unsafe JSON number must be represented as bigint");
		}
		return nestedValue;
	});
	if (result === undefined)
		throw new TypeError("Value is not JSON serializable");
	return result;
}
