import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { clientCspFindings } from './build.mjs';
import { admin2Root, assertProjectChild } from './paths.mjs';
import { pnpmSpawnSpec, publicAction } from './run.mjs';
import { verifyUpstream } from './verify-upstream.mjs';

test('only exact public actions are accepted', () => {
  for (const action of ['dev:antd', 'typecheck', 'install']) assert.equal(publicAction([action]), action);
  for (const args of [[], ['build:antd'], ['install', '--no-frozen-lockfile'], ['install & echo bad'], ['__proto__']]) {
    assert.throws(() => publicAction(args));
  }
});

test('Windows uses constant cmd commands with Admin 2.0 as actual cwd', () => {
  assert.deepEqual(pnpmSpawnSpec('install', 'win32'), {
    command: 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm install --frozen-lockfile'], cwd: admin2Root,
  });
  assert.deepEqual(pnpmSpawnSpec('typecheck', 'win32').args, ['/d', '/s', '/c', 'pnpm --filter @vben/web-antd run typecheck']);
  assert.throws(() => pnpmSpawnSpec('install & echo bad', 'win32'));
});

test('non-Windows spawns pnpm directly without shell', () => {
  assert.deepEqual(pnpmSpawnSpec('dev:antd', 'linux'), {
    command: 'pnpm', args: ['run', 'dev:antd'], cwd: admin2Root,
  });
});

test('recursive output cannot equal project root or escape it', () => {
  assert.doesNotThrow(() => assertProjectChild(admin2Root, resolve(admin2Root, 'dist')));
  assert.throws(() => assertProjectChild(admin2Root, admin2Root));
  assert.throws(() => assertProjectChild(admin2Root, resolve(admin2Root, '..')));
  assert.throws(() => assertProjectChild(admin2Root, resolve(admin2Root, '../admin20/dist')));
  assert.throws(() => assertProjectChild('relative-root', 'relative-output'));
});

test('CSP check allows bundled same-origin scripts and rejects executable inline or remote scripts', () => {
  assert.deepEqual(clientCspFindings('<script type="module" src="/js/app.js"></script>'), []);
  assert.deepEqual(clientCspFindings('<script type="application/json">{}</script>'), []);
  assert.equal(clientCspFindings('<script>window.x = true;</script>').length, 1);
  assert.equal(clientCspFindings('<script src="https://cdn.example.com/app.js"></script>').length, 1);
  assert.equal(clientCspFindings('<script src="//cdn.example.com/app.js"></script>').length, 1);
});

test('every pinned official core file matches the vendored source', async () => {
  const result = await verifyUpstream();
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.checked, result.total);
  assert.ok(result.total >= 900);
});
