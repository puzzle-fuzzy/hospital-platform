import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = {
  '.env': 'VITE_APP_TITLE=公开测试应用\nVITE_APP_NAMESPACE=synthetic\n',
  '.env.development': 'VITE_GLOB_API_URL=/api\nVITE_NITRO_MOCK=false\n',
  '.env.production': 'VITE_GLOB_API_URL=/api\nVITE_INJECT_APP_LOADING=false\n',
};

async function fixture(run) {
  const temporary = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(resolve(temporary, 'admin2-public-env-')));
  const child = relative(temporary, root);
  assert.ok(child.startsWith('admin2-public-env-') && !child.includes(sep));
  const tools = resolve(root, 'tools');
  const app = resolve(root, 'apps/web-antd');
  await mkdir(tools, { recursive: true });
  await mkdir(app, { recursive: true });
  for (const name of ['ensure-public-env.mjs', 'paths.mjs']) {
    await copyFile(resolve(TOOLS, name), resolve(tools, name));
  }
  for (const [name, body] of Object.entries(TEMPLATES)) {
    await writeFile(resolve(app, `${name}.example`), body);
  }
  const module = await import(pathToFileURL(resolve(tools, 'ensure-public-env.mjs')).href);
  try {
    await run({ app, ensure: module.ensurePublicEnv, root });
  } finally {
    assert.equal(await realpath(root), root);
    assert.equal(relative(temporary, root), child);
    assert.equal((await lstat(root)).isSymbolicLink(), false);
    await rm(root, { force: true, recursive: true });
  }
}

test('fresh checkout materializes all three fixed files and native production API config', async () => {
  await fixture(async ({ app, ensure }) => {
    const result = await ensure();
    assert.deepEqual(result.created, Object.keys(TEMPLATES));
    assert.deepEqual(result.preserved, []);
    for (const [name, body] of Object.entries(TEMPLATES)) {
      assert.deepEqual(await readFile(resolve(app, name)), Buffer.from(body));
    }
    assert.equal(result.byMode.production.VITE_GLOB_API_URL, '/api');
    assert.equal(result.byMode.production.VITE_INJECT_APP_LOADING, 'false');
    assert.equal(result.byMode.development.VITE_NITRO_MOCK, 'false');
  });
});

test('identical existing public files are preserved without rewriting bytes or timestamps', async () => {
  await fixture(async ({ app, ensure }) => {
    const instant = new Date('2020-01-01T00:00:00Z');
    for (const [name, body] of Object.entries(TEMPLATES)) {
      await writeFile(resolve(app, name), body);
      await utimes(resolve(app, name), instant, instant);
    }
    const before = await stat(resolve(app, '.env.production'));
    const result = await ensure();
    assert.deepEqual(result.created, []);
    assert.deepEqual(result.preserved, Object.keys(TEMPLATES));
    assert.equal((await stat(resolve(app, '.env.production'))).mtimeMs, before.mtimeMs);
  });
});

test('different existing bytes fail before creating anything and never appear in errors', async () => {
  await fixture(async ({ app, ensure }) => {
    const sensitiveMarker = 'SYNTHETIC_PRIVATE_VALUE_DO_NOT_PRINT';
    const path = resolve(app, '.env.production');
    await writeFile(path, sensitiveMarker);
    await assert.rejects(ensure(), (error) => {
      assert.match(error.message, /公开.*example/);
      assert.equal(error.message.includes(sensitiveMarker), false);
      return true;
    });
    assert.equal(await readFile(path, 'utf8'), sensitiveMarker);
    await assert.rejects(stat(resolve(app, '.env')), { code: 'ENOENT' });
    await assert.rejects(stat(resolve(app, '.env.development')), { code: 'ENOENT' });
  });
});

test('any local override is rejected by path before public files are materialized', async () => {
  for (const name of ['.env.local', '.env.production.local', '.env.development.local', '.env.unknown.local']) {
    await fixture(async ({ app, ensure }) => {
      const privateMarker = 'SYNTHETIC_OVERRIDE_VALUE_DO_NOT_PRINT';
      await writeFile(resolve(app, name), privateMarker);
      await assert.rejects(ensure(), (error) => {
        assert.ok(error.message.includes(name));
        assert.equal(error.message.includes(privateMarker), false);
        return true;
      });
      await assert.rejects(stat(resolve(app, '.env')), { code: 'ENOENT' });
    });
  }
});

test('template and generated-file junctions are rejected without writing through them', async (context) => {
  for (const name of ['.env', '.env.example']) {
    await fixture(async ({ app, ensure, root }) => {
      const outside = resolve(root, 'redirect');
      await mkdir(outside);
      const target = resolve(app, name);
      if (name.endsWith('.example')) await rm(target);
      try {
        await symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        if (error?.code === 'EPERM') {
          context.skip('Current user cannot create a local link fixture');
          return;
        }
        throw error;
      }
      await assert.rejects(ensure(), /符号链接|junction|解析到了其他位置/);
      await assert.rejects(stat(resolve(app, '.env.production')), { code: 'ENOENT' });
    });
  }
});

test('public templates cannot inject backend environment keys or expose values in failures', async () => {
  await fixture(async ({ app, ensure }) => {
    const marker = 'SYNTHETIC_BACKEND_SECRET_DO_NOT_PRINT';
    await writeFile(resolve(app, '.env.production.example'), `DATABASE_URL=${marker}\n`);
    await assert.rejects(ensure(), (error) => {
      assert.match(error.message, /只能配置浏览器可见的 VITE_/);
      assert.equal(error.message.includes(marker), false);
      return true;
    });
    await assert.rejects(stat(resolve(app, '.env')), { code: 'ENOENT' });
  });
});
