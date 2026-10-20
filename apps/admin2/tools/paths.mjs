import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const admin2Root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function assertProjectChild(root, target) {
  if (!isAbsolute(root) || !isAbsolute(target)) {
    throw new Error('构建目录必须是绝对路径');
  }
  const child = relative(root, target);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error('构建目录必须严格位于 Admin 2.0 项目目录内');
  }
}

/** Check every existing ancestor, including Windows junctions, before file writes. */
export async function assertNoSymlinkPath(target) {
  const resolved = resolve(target);
  const parents = [];
  let cursor = resolved;
  while (true) {
    parents.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const item of parents.reverse()) {
    let info;
    try {
      info = await lstat(item);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`拒绝符号链接或 junction：${item}`);
    if (!samePath(await realpath(item), item)) {
      throw new Error(`构建目录解析到了其他位置：${item}`);
    }
  }
}

export async function assertNoSymlinkTree(target) {
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error(`拒绝符号链接或 junction：${target}`);
  if (info.isDirectory()) {
    for (const item of await readdir(target)) {
      await assertNoSymlinkTree(resolve(target, item));
    }
  } else if (!info.isFile()) {
    throw new Error(`拒绝非普通构建文件：${target}`);
  }
}

/** The only recursively replaced output is exactly <admin2>/dist. */
export async function assertSafeDist(root = admin2Root) {
  const output = resolve(root, 'dist');
  assertProjectChild(root, output);
  await assertNoSymlinkPath(root);
  await assertNoSymlinkPath(output);
  try {
    const info = await lstat(output);
    if (!info.isDirectory()) throw new Error('Admin 2.0 dist 必须是普通目录');
    await assertNoSymlinkTree(output);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return output;
}

export function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && samePath(fileURLToPath(moduleUrl), resolve(process.argv[1]));
}
