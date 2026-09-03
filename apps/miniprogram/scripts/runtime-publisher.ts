import {
	access,
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export type MiniProgramRuntimeBuildMode = "development" | "release";

/**
 * 获取小程序待发布候选的本机隔离路径。
 *
 * 待发布候选只是在微信开发者工具锁住正式或开发运行目录时的临时副本，不是源码，
 * 不能放在 `apps/` 下，否则根目录 Biome、Git 或开发者工具都可能把它当成
 * 第二套小程序工程。统一放到仓库 `.local/` 下，既保留故障恢复能力，也
 * 让候选与正式运行包、TypeScript 源码和文档完全隔离。
 */
export function getMiniProgramPendingRuntimePath(
	packageRoot: string,
	buildMode: MiniProgramRuntimeBuildMode = "release",
): string {
	return join(
		packageRoot,
		"..",
		"..",
		".local",
		"hospital-miniprogram",
		buildMode === "development" ? "pending-development" : "pending",
	);
}

/**
 * 本地开发包必须与正式 `apps/miniprogram/dist/` 完全隔离。开发者工具打开
 * 此目录只能预览脏工作树快照，不能把它误传为正式候选或让父工程 watcher
 * 混入另一套页面图。
 */
export function getMiniProgramDevelopmentRuntimePath(
	packageRoot: string,
): string {
	return join(
		packageRoot,
		"..",
		"..",
		".local",
		"hospital-miniprogram",
		"development",
	);
}

function isMissingPath(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

/**
 * 判断运行包目录替换是否被操作系统拒绝。
 *
 * 微信开发者工具会同时监听并加载 dist/。在 Windows 上，如果此时仍处于
 * 编译、真机调试或增量热更新状态，目录 rename 可能返回 EPERM/EBUSY；这
 * 不是应该删除 dist 或复制测试脚本来绕过的业务错误，而是需要先释放工具
 * 文件句柄后再重试原子发布。把判断集中在发布层，构建脚本和回归测试可以
 * 对同一组平台错误码保持一致的维护提示。
 */
export function isMiniProgramRuntimeLockError(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return false;
	}

	const code = (error as { code?: unknown }).code;
	return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

/**
 * 生成所有发布入口共用的锁定提示。
 *
 * `build` 和 `runtime:publish-pending` 都可能遇到同一个 Windows 文件句柄
 * 错误；如果两个入口各自拼接文案，维护人员会看到不同的下一步，甚至误以为
 * pending 候选已经丢失。这里集中说明三个事实：旧运行包保留、候选已保留、
 * 关闭开发者工具后只需要执行一次匹配模式的发布命令。
 */
export function createMiniProgramRuntimeLockError(
	pendingRuntime: string,
	cause: unknown,
	publishCommand = "pnpm --filter @hospital/miniprogram runtime:publish-pending",
	runtimeLabel = "dist/",
): Error {
	return new Error(
		`Mini program runtime is locked by WeChat DevTools. The validated candidate was preserved at ${pendingRuntime}. Close the current mini-program window and any real-device debugging session, then run ${publishCommand}; the previous complete ${runtimeLabel} runtime was preserved.`,
		{ cause },
	);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		if (isMissingPath(error)) return false;
		throw error;
	}
}

/**
 * 枚举一个已经构建完成的运行目录中的相对文件路径。
 *
 * 构建发布只接收 staging 目录，不接收任意用户输入；这里仍然保留相对路径
 * 归一化，是为了让“旧 dist 是否需要清理”和“当前候选包含哪些文件”使用同一
 * 事实源，避免误删运行目录之外的内容。
 */
async function listFiles(
	root: string,
	current = "",
): Promise<readonly string[]> {
	const directory = join(root, current);
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const relativePath = current ? join(current, entry.name) : entry.name;
		if (entry.isDirectory()) {
			files.push(...(await listFiles(root, relativePath)));
		} else if (entry.isFile()) {
			files.push(relativePath);
		}
	}
	return files;
}

/**
 * 将完整 staging 运行包发布到开发者工具使用的 `dist/`。
 *
 * 绝不能在 TypeScript 编译开始时删除线上/真机正在读取的 `dist/`：微信开发者
 * 工具会监听项目目录，整目录删除会制造一段真实的“页面文件不存在”窗口，表现
 * 为 `pages/*.js` 404。这里先在 staging 中完成全部编译和静态资源复制，再把旧
 * 目录移动到项目根目录之外、但与 `dist/` 同盘的临时备份，最后把完整 staging
 * 目录移入 `dist/`。任一步替换失败都会尽力恢复旧目录，避免失败构建留下半套
 * 运行包；临时目录不进入微信开发者工具的监听范围。
 *
 * Windows 下开发者工具可能短暂持有 dist 文件。如果旧目录无法移动，函数会
 * 直接失败并保留旧运行包；调用方应关闭编译/真机调试后重试，不能退化为先删
 * 旧目录再继续写入。
 */
export async function publishMiniProgramRuntime(
	stagingRuntime: string,
	liveRuntime: string,
): Promise<void> {
	if (!(await pathExists(stagingRuntime))) {
		throw new Error("Mini program staging runtime does not exist");
	}

	const liveParent = dirname(liveRuntime);
	// liveRuntime 通常是 <repo>/apps/miniprogram/dist；向上一级放置临时备份，
	// 让它脱离 miniprogram 项目根，同时仍保持在同一文件系统中，支持快速 rename。
	const temporaryParent = dirname(liveParent);
	const backupRuntime = join(
		temporaryParent,
		`.hospital-miniprogram-backup-${process.pid}-${Date.now()}`,
	);
	let liveMoved = false;
	let newRuntimeInstalled = false;
	let preserveStagingAfterLock = false;

	try {
		await mkdir(liveParent, { recursive: true });
		if (await pathExists(liveRuntime)) {
			await rename(liveRuntime, backupRuntime);
			liveMoved = true;
		}

		await rename(stagingRuntime, liveRuntime);
		newRuntimeInstalled = true;

		// 新运行包已经完整挂载；旧目录只存在于项目根之外的备份路径，finally
		// 会递归清理它，因此旧的未注册文件不会泄漏到新的 dist，也不会触发开发者
		// 工具对项目根的临时文件监听。
	} catch (error) {
		// 目录被微信工具占用时，调用方可能希望把已经完成全部校验的
		// staging 留给后续“只发布、不重编译”的命令。非锁定错误仍按原逻辑
		// 清理 staging，避免失败产物长期留在工作区。
		preserveStagingAfterLock = isMiniProgramRuntimeLockError(error);
		// 新目录没有安装成功时，恢复旧目录；恢复失败必须把两个错误都带出，
		// 让发布人员知道不能继续启动开发者工具或上传当前 dist。
		if (liveMoved && !newRuntimeInstalled) {
			try {
				if (await pathExists(liveRuntime)) {
					await rm(liveRuntime, { recursive: true, force: true });
				}
				await rename(backupRuntime, liveRuntime);
				liveMoved = false;
			} catch (restoreError) {
				throw new Error(
					`Mini program runtime publish failed and rollback failed: ${String(restoreError)}`,
					{ cause: error },
				);
			}
		}

		throw error;
	} finally {
		// stagingRuntime 成功 rename 后路径已经不存在；失败时这里只清理未发布的
		// 临时目录，不触碰 liveRuntime 或恢复后的旧目录。备份同样在项目根之外。
		if (!preserveStagingAfterLock && (await pathExists(stagingRuntime))) {
			await rm(stagingRuntime, { recursive: true, force: true });
		}
		if (newRuntimeInstalled && (await pathExists(backupRuntime))) {
			await rm(backupRuntime, { recursive: true, force: true });
		}
	}

	// 目录替换完成后旧备份已经被清理；再次检查 live 是为了让调用方得到明确
	// 的运行包存在性，而不是只得到 rename 成功这一层的文件系统事实。
	if (!(await pathExists(liveRuntime))) {
		throw new Error("Mini program live runtime is missing after publish");
	}
}

async function filesHaveSameContents(
	leftPath: string,
	rightPath: string,
): Promise<boolean> {
	try {
		const [left, right] = await Promise.all([
			readFile(leftPath),
			readFile(rightPath),
		]);
		return left.equals(right);
	} catch (error) {
		if (isMissingPath(error)) return false;
		throw error;
	}
}

function developmentRuntimeFileOrder(relativePath: string): number {
	// 先放入页面及其依赖，最后才切换注册表和启动脚本。这样开发者工具即使
	// 恰好在监听一次保存，也只会看到“旧注册表 + 完整旧包”或“新注册表 +
	// 完整新页面”，不会要求一个尚未写入的页面模块。
	if (relativePath === "app.json") return 1;
	if (
		relativePath === "app.js" ||
		relativePath === "project.config.json" ||
		relativePath === "build-info.json"
	) {
		return 2;
	}
	return 0;
}

/**
 * 开发者工具会把打开目录本身作为 worker 模块图的根。整目录 rename 虽然对
 * 发布物是原子的，但会让工具短暂持有一个已移走的目录，进而报
 * `module 'app.js' is not defined`。开发模式因此保持根目录 inode 不变：
 * 每个已变更文件先复制到运行根外的临时目录，再以单文件 rename 覆盖；所有
 * 页面文件先于 app.json，app.js 最后替换，旧模块路径始终存在。
 *
 * 正式 dist 继续使用上面的整目录原子发布，本函数只用于 development runtime。
 */
export async function publishMiniProgramDevelopmentRuntime(
	stagingRuntime: string,
	liveRuntime: string,
): Promise<void> {
	if (!(await pathExists(stagingRuntime))) {
		throw new Error("Mini program development staging runtime does not exist");
	}

	if (!(await pathExists(liveRuntime))) {
		await publishMiniProgramRuntime(stagingRuntime, liveRuntime);
		return;
	}

	const stagingFiles = [...(await listFiles(stagingRuntime))].sort(
		(left, right) => {
			const orderDifference =
				developmentRuntimeFileOrder(left) - developmentRuntimeFileOrder(right);
			return orderDifference || left.localeCompare(right);
		},
	);
	const stagingFileSet = new Set(stagingFiles);
	const liveFiles = await listFiles(liveRuntime);
	const syncDirectory = await mkdtemp(
		join(dirname(liveRuntime), ".hospital-miniprogram-development-sync-"),
	);

	try {
		for (const relativePath of stagingFiles) {
			const stagedFile = join(stagingRuntime, relativePath);
			const liveFile = join(liveRuntime, relativePath);
			if (await filesHaveSameContents(stagedFile, liveFile)) continue;

			const replacementFile = join(syncDirectory, relativePath);
			await mkdir(dirname(replacementFile), { recursive: true });
			await copyFile(stagedFile, replacementFile);
			await mkdir(dirname(liveFile), { recursive: true });
			await rename(replacementFile, liveFile);
		}

		// app.json 已在上一步靠后替换完成，残留的旧页面或资源现在才可安全
		// 删除；它们从不会在新注册表生效前消失。
		for (const relativePath of liveFiles) {
			if (!stagingFileSet.has(relativePath)) {
				await rm(join(liveRuntime, relativePath), { force: true });
			}
		}
	} finally {
		await rm(syncDirectory, { recursive: true, force: true });
		await rm(stagingRuntime, { recursive: true, force: true });
	}
}

/** 仅供构建测试复核发布目录的文件集合，不暴露任何业务数据。 */
export async function listRuntimeFiles(
	runtime: string,
): Promise<readonly string[]> {
	return listFiles(runtime);
}

/**
 * 找出微信运行包中仍然依赖 workspace 裸模块的 JavaScript 文件。
 *
 * 小程序的 CommonJS 运行时不会执行 pnpm workspace 的解析规则；像
 * `require("@hospital/contracts")` 这样的代码在 TypeScript 编译阶段可能
 * 没有报错，却会在开发者工具或真机加载模块时失败。类型文件可以继续
 * 引用共享契约，但真正进入 dist 的 JavaScript 必须只依赖本地运行模块。
 */
export async function findForbiddenWorkspaceImports(
	runtime: string,
): Promise<readonly string[]> {
	const runtimeFiles = await listRuntimeFiles(runtime);
	const forbiddenFiles: string[] = [];
	const workspaceImportPattern =
		/(?:require\s*\(\s*["']@hospital\/|(?:from\s+|import\s*\(\s*)["']@hospital\/)/u;

	for (const file of runtimeFiles.filter((entry) => entry.endsWith(".js"))) {
		const contents = await Bun.file(join(runtime, file)).text();
		if (workspaceImportPattern.test(contents)) forbiddenFiles.push(file);
	}

	return forbiddenFiles;
}

/**
 * 找出运行包中无法解析的相对 CommonJS 模块引用。
 *
 * TypeScript 页面脚本会被编译成 `require("./module")`。微信运行时不会像
 * Node 一样替我们补齐不存在的文件；如果旧 dist、增量编译缓存或错误的构建
 * 排除规则留下了 `require("./single-flight.test")`，真机只会在加载页面时给出
 * ENOENT，开发阶段很难从页面源码直接看出根因。把相对引用完整性放在发布门禁
 * 中，可以在构建阶段报告“哪个运行文件引用了哪个缺失模块”。
 */
export async function findMissingRelativeImports(
	runtime: string,
): Promise<readonly string[]> {
	const runtimeFiles = await listRuntimeFiles(runtime);
	const missing: string[] = [];
	const requirePattern = /require\s*\(\s*["'](\.[^"']+)["']\s*\)/gu;

	for (const file of runtimeFiles
		.filter((entry) => entry.endsWith(".js"))
		.sort()) {
		const contents = await Bun.file(join(runtime, file)).text();
		requirePattern.lastIndex = 0;
		for (const match of contents.matchAll(requirePattern)) {
			const specifier = match[1];
			if (!specifier) continue;

			const target = join(dirname(file), specifier);
			const candidates = [
				target,
				`${target}.js`,
				`${target}.json`,
				join(target, "index.js"),
			];
			let resolved = false;
			for (const candidate of candidates) {
				if (await pathExists(join(runtime, candidate))) {
					resolved = true;
					break;
				}
			}
			if (!resolved) missing.push(`${file} -> ${specifier}`);
		}
	}

	return missing;
}
