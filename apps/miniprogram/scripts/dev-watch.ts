import { type FSWatcher, statSync, watch } from "node:fs";
import { join } from "node:path";
import { resolveDevelopmentMiniProgramRuntimeSnapshot } from "./runtime-provenance";

const packageRoot = join(import.meta.dir, "..");
const repositoryRoot = join(packageRoot, "..", "..");
const rebuildDebounceMilliseconds = 200;

/**
 * 只监听会影响 development runtime 的输入，绝不监听 `.local/` 开发产物。
 * 否则每次原子发布都会再次触发自己，造成无休止的重复构建。
 */
const watchTargets = [
	join(packageRoot, "src"),
	join(packageRoot, "scripts", "build.ts"),
	join(packageRoot, "scripts", "runtime-provenance.ts"),
	join(packageRoot, "scripts", "runtime-publisher.ts"),
	join(packageRoot, "tsconfig.build.json"),
	join(packageRoot, "package.json"),
	join(packageRoot, "project.config.json"),
	join(packageRoot, "turbo.json"),
	join(repositoryRoot, "packages", "contracts", "src"),
	join(repositoryRoot, "pnpm-lock.yaml"),
] as const;

function isIgnoredChange(fileName: string | Buffer | null): boolean {
	if (fileName === null) return false;
	const value = String(fileName);
	return (
		/\.(?:test|spec)\.ts$/u.test(value) ||
		/(?:^|\/)\.(?:DS_Store|swp|swo)$/u.test(value) ||
		value.endsWith("~")
	);
}

let activeBuild: Promise<void> | undefined;
let lastHandledSourceRevision: string | undefined;
let rebuildQueued = false;
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

function readDevelopmentSnapshot(): string | undefined {
	try {
		return resolveDevelopmentMiniProgramRuntimeSnapshot(repositoryRoot)
			.sourceRevision;
	} catch (error) {
		console.error(
			`[小程序开发构建] 无法读取当前源码快照：${String(error)}。将等待下一次文件变动。`,
		);
		return undefined;
	}
}

async function runDevelopmentBuild(): Promise<void> {
	if (activeBuild) {
		rebuildQueued = true;
		return;
	}

	const sourceRevisionAtBuildStart = readDevelopmentSnapshot();
	activeBuild = (async () => {
		console.info("[小程序开发构建] 开始生成 development 运行包");
		const child = Bun.spawn(["pnpm", "run", "build:dev"], {
			cwd: packageRoot,
			stdout: "inherit",
			stderr: "inherit",
		});
		const exitCode = await child.exited;
		if (exitCode === 0) {
			console.info(
				"[小程序开发构建] 已更新 .local/hospital-miniprogram/development；请在开发者工具中执行普通编译。",
			);
		} else {
			console.error(
				`[小程序开发构建] 失败（exit ${exitCode}）；上一份完整 development 运行包已保留，继续监听源码。`,
			);
		}
	})();

	try {
		await activeBuild;
	} finally {
		activeBuild = undefined;
		const sourceRevisionAfterBuild = readDevelopmentSnapshot();
		const sourceChangedDuringBuild =
			Boolean(sourceRevisionAtBuildStart) &&
			Boolean(sourceRevisionAfterBuild) &&
			sourceRevisionAtBuildStart !== sourceRevisionAfterBuild;
		if (!sourceChangedDuringBuild) {
			// 不论构建成功还是失败，这个快照都已经被本轮尝试处理；后续没有
			// 内容变更的 FSEvents 只会被忽略，避免 read/metadata 事件造成循环。
			lastHandledSourceRevision =
				sourceRevisionAfterBuild ?? sourceRevisionAtBuildStart;
		}
		if ((sourceChangedDuringBuild || rebuildQueued) && !stopped) {
			rebuildQueued = false;
			queueDevelopmentBuild();
		}
	}
}

function queueDevelopmentBuild(): void {
	if (stopped) return;
	if (rebuildTimer) clearTimeout(rebuildTimer);
	rebuildTimer = setTimeout(() => {
		rebuildTimer = undefined;
		const currentSourceRevision = readDevelopmentSnapshot();
		if (
			currentSourceRevision &&
			currentSourceRevision === lastHandledSourceRevision
		) {
			return;
		}
		void runDevelopmentBuild();
	}, rebuildDebounceMilliseconds);
}

const watchers: FSWatcher[] = [];
try {
	for (const target of watchTargets) {
		const recursive = statSync(target).isDirectory();
		watchers.push(
			watch(target, { recursive }, (_eventType, fileName) => {
				if (!isIgnoredChange(fileName)) queueDevelopmentBuild();
			}),
		);
	}
} catch (error) {
	for (const watcher of watchers) watcher.close();
	throw new Error(
		"Unable to start the mini program development watcher. Use pnpm --filter @hospital/miniprogram build:dev for one build on this platform.",
		{ cause: error },
	);
}

function stopWatching(): void {
	if (stopped) return;
	stopped = true;
	if (rebuildTimer) clearTimeout(rebuildTimer);
	for (const watcher of watchers) watcher.close();
}

function stopWatchingAndExit(): void {
	stopWatching();
	process.exit(0);
}

process.once("SIGINT", stopWatchingAndExit);
process.once("SIGTERM", stopWatchingAndExit);

console.info(
	"[小程序开发构建] 正在监听源码；development 运行包与正式 dist 完全隔离。",
);
void runDevelopmentBuild();

await new Promise<void>(() => {
	// 监听器保持进程存活；SIGINT/SIGTERM 会关闭 watcher。
});
