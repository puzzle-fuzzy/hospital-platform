/** HIS 使用 Java Long；内部始终保存十进制字符串，避免 19 位编号丢失精度。 */
export const MAX_HIS_PAYMENT_REFERENCE = "9223372036854775807";

export class HisPaymentReferenceConflictError extends Error {
	constructor() {
		super("HIS payment reference belongs to a different payment record");
		this.name = "HisPaymentReferenceConflictError";
	}
}

export class HisPaymentReferenceNotInitializedError extends Error {
	constructor() {
		super(
			"HIS payment reference numbering requires a complete historical index",
		);
		this.name = "HisPaymentReferenceNotInitializedError";
	}
}

export class HisPaymentReferenceExhaustedError extends Error {
	constructor() {
		super(
			"HIS payment reference numbering has no remaining signed Long values",
		);
		this.name = "HisPaymentReferenceExhaustedError";
	}
}

export function normalizeHisPaymentReference(value: unknown): string {
	const text =
		typeof value === "string"
			? value
			: typeof value === "bigint"
				? value.toString()
				: typeof value === "number" && Number.isSafeInteger(value)
					? String(value)
					: "";
	if (
		!/^[1-9]\d{0,18}$/u.test(text) ||
		BigInt(text) > BigInt(MAX_HIS_PAYMENT_REFERENCE)
	) {
		throw new Error(
			"HIS payment reference must be a positive signed 64-bit integer",
		);
	}
	return text;
}

export type HisPaymentReferenceScope = {
	ownerUserId: string;
	medicalOrderId: string;
	/** 原支付记录，不使用就诊号、患者号或当前最新支付单替代。 */
	paymentScopeId: string;
	source: "plugin" | "component";
};

export type HisPaymentReference = HisPaymentReferenceScope & {
	/** 实际公开的发送号或历史回执；绝不返回内部 scope 主键。 */
	referenceId: string;
	/** 实际分配过的发送号；历史回填不创建合成发送号。 */
	requestReferenceId?: string;
	/** 预分配号不表示 HIS 已登记成功。 */
	status: "allocated" | "confirmed";
	/** HIS 成功回执；若与发送号不同，两者都必须唯一绑定同一支付记录。 */
	receiptId?: string;
	createdAt: string;
};

export interface HisPaymentReferenceRepository {
	allocate(scope: HisPaymentReferenceScope): Promise<HisPaymentReference>;
	/** 只允许调用方根据已持久化的成功事实导入或确认回执。 */
	confirm(
		input: HisPaymentReferenceScope & { referenceId: string },
	): Promise<HisPaymentReference>;
	findByReferenceId(
		referenceId: string,
	): Promise<HisPaymentReference | undefined>;
	findByScope(
		scope: HisPaymentReferenceScope,
	): Promise<HisPaymentReference | undefined>;
	/** 仅完整历史数字回执索引核对通过后显式调用，生产默认关闭。 */
	initializeNewNumbering(): Promise<void>;
	/** 已确认同号属于多个支付时隔离；不存在的别名不生成占位编号。 */
	quarantineReferenceId(referenceId: string): Promise<void>;
}
