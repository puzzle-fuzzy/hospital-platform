#!/usr/bin/env bun

/**
 * 3090 最新一笔支付日志导出器。
 *
 * 复用日支付导出器的同一套 journald、订单关联、FSI chunk 完整性校验和
 * 明文 JSON 输出，只把最终结果限制为开始时间最新的一笔支付，并只在
 * 标准输出返回 daily-index.md 路径。
 */

import { main } from "./payment-day-export.mjs";

if (import.meta.main) {
	try {
		await main(["--latest", ...process.argv.slice(2)]);
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "payment-latest-export failed",
		);
		process.exitCode = 1;
	}
}
