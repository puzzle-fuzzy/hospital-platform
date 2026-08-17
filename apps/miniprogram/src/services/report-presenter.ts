import type { LaboratoryReportItem, LaboratoryReportItemView } from "../types";

/**
 * 服务端 flag 是稳定机器枚举，不是面向患者的最终文案。
 * 显示层集中映射，避免页面直接渲染 high、critical 等内部值，也便于
 * 后续统一调整医疗提示词而不改 API contract 或 provider adapter。
 */
export const LABORATORY_FLAG_LABELS = Object.freeze({
	normal: "正常",
	high: "偏高",
	low: "偏低",
	critical: "危急",
	unknown: "待确认",
} as const satisfies Record<LaboratoryReportItem["flag"], string>);

export function toLaboratoryReportItemView(
	item: LaboratoryReportItem,
): LaboratoryReportItemView {
	return {
		...item,
		flagLabel: LABORATORY_FLAG_LABELS[item.flag],
	};
}
