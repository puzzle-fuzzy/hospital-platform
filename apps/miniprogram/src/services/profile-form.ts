/**
 * 个人资料年龄输入的解析结果。
 *
 * 输入框阶段必须保留用户原文，只有点击“保存”这种命令边界才解析；否则
 * 把 `-1`、`1.5` 等非法输入提前删除字符，会把用户实际输入悄悄改成 `1`、
 * `15`，最终可能把错误资料当成合法资料提交。
 */
export type ProfileAgeInputResult =
	| { kind: "empty"; value: null }
	| { kind: "valid"; value: number }
	| { kind: "invalid"; value: null };

/**
 * 严格解析普通资料年龄。
 *
 * 年龄是展示资料，不允许负数、小数、科学计数法、字母或超过 150 的值；
 * 空字符串才代表用户主动清空年龄。这里不依赖输入控件的 `type=number`，
 * 因为开发者工具、真机键盘和自动化事件对该控件的输入形态并不完全一致。
 */
export function parseProfileAgeInput(value: unknown): ProfileAgeInputResult {
	if (typeof value !== "string") return { kind: "invalid", value: null };
	const normalized = value.trim();
	if (!normalized) return { kind: "empty", value: null };
	if (!/^\d+$/u.test(normalized)) {
		return { kind: "invalid", value: null };
	}

	const age = Number(normalized);
	if (!Number.isSafeInteger(age) || age < 0 || age > 150) {
		return { kind: "invalid", value: null };
	}
	return { kind: "valid", value: age };
}
