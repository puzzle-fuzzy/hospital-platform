import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import {
  admin2Root,
  assertNoSymlinkPath,
  assertNoSymlinkTree,
  assertProjectChild,
  assertSafeDist,
  isMain,
} from './paths.mjs';
import { runFixedPnpm } from './run.mjs';
import { verifyUpstream } from './verify-upstream.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function clientCspFindings(html) {
  const findings = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const [, attributes, body] = match;
    const source = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!source && body.trim() && !/\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attributes)) {
      findings.push('HTML 含内联脚本，现有 script-src self 会拦截；请在应用配置关闭或提取为同源文件。');
    }
    if (source && /^(?:https?:)?\/\/|^(?:data|javascript):/i.test(source)) {
      findings.push('HTML 引用了非同源脚本，与现有 CSP 不兼容。');
    }
  }
  return [...new Set(findings)];
}

export async function build() {
  if (process.argv.length > 2) throw new Error('build.mjs 不接受额外参数');
  const core = await verifyUpstream();
  if (!core.ok) throw new Error(`官方核心源文件校验失败：${core.failures.map((item) => item.file).join(', ')}`);
  const lockPath = resolve(admin2Root, 'pnpm-lock.yaml');
  const lockHash = sha256(await readFile(lockPath));
  const applicationDist = resolve(admin2Root, 'apps/web-antd/dist');
  assertProjectChild(admin2Root, applicationDist);
  await assertNoSymlinkPath(applicationDist);
  try {
    await assertNoSymlinkTree(applicationDist);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await assertSafeDist();

  console.log('[admin2] 在独立 Vben workspace 构建官方 web-antd 应用');
  await runFixedPnpm('build:antd');
  if (sha256(await readFile(lockPath)) !== lockHash) throw new Error('构建修改了 pnpm-lock.yaml，停止交付');
  const after = await verifyUpstream();
  if (!after.ok) throw new Error('官方构建后核心源文件发生变化，停止交付');
  await assertNoSymlinkPath(applicationDist);
  await assertNoSymlinkTree(applicationDist);
  if (!(await stat(resolve(applicationDist, 'index.html'))).isFile()) {
    throw new Error('官方应用构建缺少 index.html');
  }
  const findings = clientCspFindings(await readFile(resolve(applicationDist, 'index.html'), 'utf8'));
  for (const finding of findings) console.warn(`[admin2] CSP 检查：${finding}`);
  if (findings.length > 0) throw new Error('客户端 HTML 与现有管理端 CSP 不兼容，停止打包');

  // Check immediately before recursive replacement; never remove arbitrary paths.
  const output = await assertSafeDist();
  await rm(output, { force: true, recursive: true });
  await mkdir(output, { recursive: true });
  await cp(applicationDist, resolve(output, 'client'), { recursive: true, force: false, errorOnExist: true });
  const serverSource = resolve(admin2Root, '../admin/src/server.ts');
  const serverOutput = resolve(output, 'server.js');
  console.log('[admin2] 复用原 Admin Bun 同源服务端，不改变 API 或权限');
  await new Promise((done, reject) => {
    const child = spawn('bun', ['build', serverSource, '--outfile', serverOutput, '--target', 'bun'], {
      cwd: admin2Root,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`管理服务构建失败（${signal || code}）`)));
  });
  if (!(await stat(serverOutput)).isFile()) throw new Error('管理服务构建缺少 server.js');
  console.log(`[admin2] 完整交付目录：${relative(resolve(admin2Root, '../..'), output)}`);
  console.log(`[admin2] 官方核心 ${after.checked}/${after.total} 文件一致，锁文件保持原样`);
}

if (isMain(import.meta.url)) {
  try {
    await build();
  } catch (error) {
    console.error(`[admin2] ${error.message}`);
    process.exitCode = 1;
  }
}
