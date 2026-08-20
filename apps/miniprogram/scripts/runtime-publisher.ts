import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

function isMissingPath(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
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
 * 目录移动到同一父目录下的临时备份，最后把完整 staging 目录移入 `dist/`。
 * 任一步替换失败都会尽力恢复旧目录，避免失败构建留下半套运行包。
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
	const backupRuntime = join(
		liveParent,
		`.hospital-runtime-backup-${process.pid}-${Date.now()}`,
	);
	let liveMoved = false;
	let newRuntimeInstalled = false;

	try {
		await mkdir(liveParent, { recursive: true });
		if (await pathExists(liveRuntime)) {
			await rename(liveRuntime, backupRuntime);
			liveMoved = true;
		}

		await rename(stagingRuntime, liveRuntime);
		newRuntimeInstalled = true;

		// 新运行包已经完整挂载后再清理旧文件。即使某个旧文件被开发者工具
		// 暂时占用，也不能回到“先清空 dist 再构建”的危险路径；旧的未注册文件
		// 不会被 app.json 引用，保留它只记录为警告，不影响当前候选可启动。
		const desiredFiles = new Set(await listFiles(liveRuntime));
		const previousFiles = await listFiles(backupRuntime).catch(() => []);
		for (const previousFile of previousFiles) {
			if (desiredFiles.has(previousFile)) continue;
			try {
				await rm(join(liveRuntime, previousFile), {
					force: true,
					recursive: false,
				});
			} catch {
				console.warn(
					`Mini program runtime kept an obsolete unregistered file: ${previousFile}`,
				);
			}
		}
	} catch (error) {
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
		// 临时目录，不触碰 liveRuntime 或恢复后的旧目录。
		if (await pathExists(stagingRuntime)) {
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

/** 仅供构建测试复核发布目录的文件集合，不暴露任何业务数据。 */
export async function listRuntimeFiles(
	runtime: string,
): Promise<readonly string[]> {
	return listFiles(runtime);
}
