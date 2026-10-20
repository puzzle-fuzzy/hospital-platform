import { lstat, open, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { admin2Root, assertNoSymlinkPath, assertProjectChild, isMain } from './paths.mjs';

const APPLICATION = resolve(admin2Root, 'apps/web-antd');
const FILES = Object.freeze([
  { target: '.env', template: '.env.example' },
  { target: '.env.development', template: '.env.development.example' },
  { target: '.env.production', template: '.env.production.example' },
]);

async function rejectLocalOverrides() {
  const names = await readdir(APPLICATION);
  const overrides = names.filter((name) => /^\.env(?:\..+)?\.local$/i.test(name));
  if (overrides.length > 0) {
    throw new Error(`拒绝本地覆盖配置：apps/web-antd/${overrides.sort().join('、')}。请通过已提交的公开 .env*.example 配置构建参数。`);
  }
}

function mismatch(target) {
  return new Error(`apps/web-antd/${target} 与公开模板字节不一致，未覆盖。请通过已提交的公开 .env*.example 配置，并主动核对本地生成文件；不要使用后端凭据或 .env.local。`);
}

async function matchingExisting(path, body, target) {
  await assertNoSymlinkPath(path);
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!info.isFile()) throw new Error(`apps/web-antd/${target} 必须是普通生成文件`);
  if (!body.equals(await readFile(path))) throw mismatch(target);
  return true;
}

/** Materialize only the three fixed public templates; never overwrite other bytes. */
export async function ensurePublicEnv() {
  assertProjectChild(admin2Root, APPLICATION);
  await assertNoSymlinkPath(APPLICATION);
  if (!(await lstat(APPLICATION)).isDirectory()) throw new Error('缺少 apps/web-antd 应用目录');
  await rejectLocalOverrides();
  const plans = [];
  for (const entry of FILES) {
    const templatePath = resolve(APPLICATION, entry.template);
    const targetPath = resolve(APPLICATION, entry.target);
    assertProjectChild(APPLICATION, templatePath);
    assertProjectChild(APPLICATION, targetPath);
    await assertNoSymlinkPath(templatePath);
    if (!(await lstat(templatePath)).isFile()) throw new Error(`公开模板不是普通文件：${entry.template}`);
    const body = await readFile(templatePath);
    const values = parseEnv(body.toString('utf8'));
    if (Object.keys(values).some((key) => !key.startsWith('VITE_'))) {
      throw new Error(`公开模板 ${entry.template} 只能配置浏览器可见的 VITE_ 参数，不得包含后端环境配置。`);
    }
    plans.push({ ...entry, body, values, targetPath, existed: await matchingExisting(targetPath, body, entry.target) });
  }
  // Preflight every existing file before creating any missing one.
  const created = [];
  const preserved = [];
  for (const plan of plans) {
    if (plan.existed) {
      if (!await matchingExisting(plan.targetPath, plan.body, plan.target)) throw mismatch(plan.target);
      preserved.push(plan.target);
      continue;
    }
    await assertNoSymlinkPath(plan.targetPath);
    let descriptor;
    try {
      // Exclusive creation also rejects a file/link created between preflight and open.
      descriptor = await open(plan.targetPath, 'wx', 0o600);
      await descriptor.writeFile(plan.body);
      await descriptor.sync();
      created.push(plan.target);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (!await matchingExisting(plan.targetPath, plan.body, plan.target)) throw mismatch(plan.target);
      preserved.push(plan.target);
    } finally {
      await descriptor?.close();
    }
  }
  await rejectLocalOverrides();
  for (const plan of plans) {
    if (!await matchingExisting(plan.targetPath, plan.body, plan.target)) throw mismatch(plan.target);
  }
  return {
    created,
    preserved,
    byMode: {
      development: { ...plans[0].values, ...plans[1].values },
      production: { ...plans[0].values, ...plans[2].values },
    },
  };
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error('公开配置生成器不接受参数');
    const { created, preserved } = await ensurePublicEnv();
    console.log(`[admin2] 公开配置：新建 ${created.length} 个，原样保留 ${preserved.length} 个；未输出配置值`);
  } catch (error) {
    console.error(`[admin2] ${error.message}`);
    process.exitCode = 1;
  }
}
