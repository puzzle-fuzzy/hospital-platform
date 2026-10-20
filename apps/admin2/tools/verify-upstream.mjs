import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { admin2Root, assertNoSymlinkPath, assertProjectChild, isMain } from './paths.mjs';

const EXPECTED_REVISION = '63a38dce49ba109f61607994e21ba921d8e970e9';
const EXPECTED_PACKAGE_MANAGER = 'pnpm@10.33.4';

export async function verifyUpstream(root = admin2Root) {
  await assertNoSymlinkPath(root);
  const manifest = JSON.parse(await readFile(resolve(root, 'UPSTREAM.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (manifest.tag !== 'v5.7.0' || manifest.revision !== EXPECTED_REVISION) {
    throw new Error('UPSTREAM.json 与选定的官方 Vben 5.7.0 revision 不符');
  }
  if (packageJson.packageManager !== EXPECTED_PACKAGE_MANAGER) {
    throw new Error(`官方 packageManager 必须保留 ${EXPECTED_PACKAGE_MANAGER}`);
  }
  const hashes = manifest.unmodifiedCoreSha256;
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) {
    throw new Error('UPSTREAM.json 缺少原始核心文件 SHA-256 清单');
  }
  const entries = Object.entries(hashes);
  if (entries.length === 0) throw new Error('官方核心校验清单不能为空');
  const failures = [];
  let checked = 0;
  for (const [file, expected] of entries) {
    if (
      !/^(?:packages|internal)\/(?!.*(?:^|\/)\.\.?\/)[^\\]+$/.test(file) ||
      file.split('/').some((part) => !part || part === '.' || part === '..') ||
      !/^[a-f0-9]{64}$/.test(expected)
    ) {
      throw new Error(`官方核心清单条目不合法：${file}`);
    }
    const absolute = resolve(root, file);
    assertProjectChild(root, absolute);
    try {
      await assertNoSymlinkPath(absolute);
      const actual = createHash('sha256').update(await readFile(absolute)).digest('hex');
      checked += 1;
      if (actual !== expected) failures.push({ file, problem: '内容已变更' });
    } catch (error) {
      failures.push({ file, problem: error?.code === 'ENOENT' ? '原文件缺失' : '路径不可读取或含链接' });
    }
  }
  return {
    checked,
    failures,
    generatedOutputs: '官方构建生成的 dist、node_modules 等文件不属于原始源文件清单',
    ok: failures.length === 0,
    revision: manifest.revision,
    tag: manifest.tag,
    total: entries.length,
  };
}

if (isMain(import.meta.url)) {
  try {
    const result = await verifyUpstream();
    console.log(`[admin2] 官方 Vben ${result.tag} ${result.revision}`);
    console.log(`[admin2] 已校验 ${result.checked}/${result.total} 个原始 packages/internal 文件`);
    console.log(`[admin2] ${result.generatedOutputs}`);
    for (const failure of result.failures) console.error(`[admin2] ${failure.problem}：${failure.file}`);
    console.log(`[admin2] 核心源文件${result.ok ? '保持原样' : '校验失败'}`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`[admin2] 官方核心校验失败：${error.message}`);
    process.exitCode = 1;
  }
}
