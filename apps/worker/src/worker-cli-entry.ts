/** Bun bundle 里的 import.meta.main 可能同时命中被 re-export 的 CLI 模块。 */
export function isWorkerCliEntry(
	moduleIsMain: boolean,
	toolName: string,
	entryPath: string | undefined = process.argv[1],
): boolean {
	if (!moduleIsMain || !entryPath) return false;
	// 部署运行于 Linux，开发运行于 Windows；不依赖当前系统的 path.basename 规则。
	const basename = entryPath.split(/[\\/]/u).at(-1);
	return basename === `${toolName}.ts` || basename === `${toolName}.js`;
}
