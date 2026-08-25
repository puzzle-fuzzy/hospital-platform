/**
 * 统一处理健康知识 bundle 检查命令的参数边界。
 *
 * pnpm 在执行 workspace script 时可能把命令分隔符 `--` 一并转发给 Bun；
 * 这个分隔符不是输入文件路径，只允许在第一个参数位置被去掉一次。其余
 * 参数仍然交给 CLI 做严格拒绝，避免误把多个文件或未知选项当成审核输入。
 */
export function normalizeHealthKnowledgeBundleCliArguments(
	args: readonly string[],
): { inputPath: string | undefined; extraArguments: string[] } {
	const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
	return {
		inputPath: normalizedArgs[0],
		extraArguments: [...normalizedArgs.slice(1)],
	};
}
