import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { parseEnv } from 'node:util';

import { admin2Root, isMain } from './paths.mjs';

// Command strings are constants, never assembled from command-line input.
const COMMANDS = Object.freeze({
  'build:antd': { args: ['run', 'build:antd'], windows: 'pnpm run build:antd' },
  'dev:antd': { args: ['run', 'dev:antd'], windows: 'pnpm run dev:antd' },
  install: { args: ['install', '--frozen-lockfile'], windows: 'pnpm install --frozen-lockfile' },
  typecheck: {
    args: ['--filter', '@vben/web-antd', 'run', 'typecheck'],
    windows: 'pnpm --filter @vben/web-antd run typecheck',
  },
});
const PUBLIC_ACTIONS = new Set(['dev:antd', 'typecheck', 'install']);

export function pnpmSpawnSpec(action, platform = process.platform) {
  if (!Object.hasOwn(COMMANDS, action)) throw new Error('不支持的 Admin 2.0 命令');
  const command = COMMANDS[action];
  return platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', command.windows], cwd: admin2Root }
    : { command: 'pnpm', args: [...command.args], cwd: admin2Root };
}

export function publicAction(argv) {
  if (argv.length !== 1 || !PUBLIC_ACTIONS.has(argv[0])) {
    throw new Error('用法：node apps/admin2/tools/run.mjs dev:antd|typecheck|install');
  }
  return argv[0];
}

export async function runFixedPnpm(action) {
  const spec = pnpmSpawnSpec(action);
  const mode = action === 'build:antd' ? 'production' : 'development';
  const publicEnv = action === 'build:antd' || action === 'dev:antd' ? {
    ...parseEnv(await readFile(resolvePath(admin2Root, 'apps/web-antd/.env.example'), 'utf8')),
    ...parseEnv(await readFile(resolvePath(admin2Root, `apps/web-antd/.env.${mode}.example`), 'utf8')),
  } : {};
  await new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...publicEnv, ...process.env, ...(action === 'install' ? { CI: 'true', LEFTHOOK: '0' } : {}) },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Admin 2.0 ${action} 失败（${signal || code}）`));
    });
  });
}

if (isMain(import.meta.url)) {
  try {
    await runFixedPnpm(publicAction(process.argv.slice(2)));
  } catch (error) {
    console.error(`[admin2] ${error.message}`);
    process.exitCode = 1;
  }
}
