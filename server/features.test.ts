// server/features.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage } from 'node:http';
import { FeatureRegistry, createFeatureState } from './features.ts';
import { Router, type HttpServer } from './http.ts';

test('missing optional feature stays off and does not throw', async () => {
  const features = new FeatureRegistry();
  await features.load({} as HttpServer, ['@wanderxuhq/anther-feature-definitely-missing']);
  assert.deepEqual(features.snapshot(), {});
});

test('feature flags, workspace hook and dispose are wired through mount()', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anther-feature-'));
  const file = path.join(dir, 'fixture.mjs');
  await writeFile(file, `
    export const feature = {
      id: 'fixture',
      version: '1.2.3',
      panels: [{
        id: 'fixture',
        title: 'Fixture',
        icon: 'sparkles',
        route: '/_/fixture',
        ui: '/_/fixture/ui.js'
      }]
    };
    export async function register(ctx) {
      globalThis.__featureStateDir = await ctx.state.ensure('fixture');
      globalThis.__featureStateFile = ctx.state.file('fixture', 'sessions.db');
      try { ctx.state.file('fixture', '..', 'secret'); } catch (e) { globalThis.__featureStateError = e.message; }
      ctx.onWorkspace(({ dir, base }) => {
        globalThis.__featureWorkspace = { dir, base };
      });
      ctx.onDispose(() => {
        globalThis.__featureDisposed = true;
      });
    }
  `);

  const features = new FeatureRegistry(dir);
  try {
    await features.load({} as HttpServer, [pathToFileURL(file).href]);
    assert.deepEqual(features.snapshot(), {
      fixture: {
        id: 'fixture',
        version: '1.2.3',
        panels: [{
          id: 'fixture',
          title: 'Fixture',
          icon: 'sparkles',
          route: '/_/fixture',
          ui: '/_/fixture/ui.js',
        }],
      },
    });

    const router = new Router();
    features.mount({ dir: '/tmp/workspace', router, base: '/-/ws/-/0' });
    assert.deepEqual((globalThis as any).__featureWorkspace, { dir: '/tmp/workspace', base: '/-/ws/-/0' });

    const handler = router.handler('GET', '/api/features');
    assert.ok(handler);
    assert.deepEqual(await handler({} as IncomingMessage, undefined, new URLSearchParams()), features.snapshot());

    assert.equal((globalThis as any).__featureStateDir, `${dir}/fixture`);
    assert.equal((globalThis as any).__featureStateFile, `${dir}/fixture/sessions.db`);
    assert.match((globalThis as any).__featureStateError, /invalid state path segment/);
    assert.equal((await stat(`${dir}/fixture`)).isDirectory(), true);

    await features.dispose();
    assert.equal((globalThis as any).__featureDisposed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete (globalThis as any).__featureWorkspace;
    delete (globalThis as any).__featureDisposed;
    delete (globalThis as any).__featureStateDir;
    delete (globalThis as any).__featureStateFile;
    delete (globalThis as any).__featureStateError;
  }
});

test('feature state paths stay inside the feature directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anther-state-'));
  try {
    const state = createFeatureState(dir);
    assert.equal(state.dir('opencode'), `${dir}/opencode`);
    assert.equal(state.file('opencode', 'sessions.db'), `${dir}/opencode/sessions.db`);
    assert.equal(state.file('opencode', 'cache', 'models.json'), `${dir}/opencode/cache/models.json`);
    assert.throws(() => state.dir('../escape'), /invalid feature id/);
    assert.throws(() => state.file('opencode', '..', 'secret'), /invalid state path segment/);
    assert.throws(() => state.file('opencode', 'nested/../../secret'), /invalid state path segment/);
    assert.equal(await state.ensure('opencode'), `${dir}/opencode`);
    const featureDirInfo = await stat(`${dir}/opencode`);
    assert.equal(featureDirInfo.isDirectory(), true);
    if (process.platform !== 'win32') assert.equal(featureDirInfo.mode & 0o077, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reserved or conflicting panel routes are rejected', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anther-feature-'));
  const file = path.join(dir, 'reserved.mjs');
  await writeFile(file, `
    export const feature = {
      id: 'reserved',
      version: '1.0.0',
      panels: [{
        id: 'git',
        title: 'Git',
        icon: 'git-branch',
        route: '/_/git',
        ui: '/_/git/ui.js'
      }]
    };
    export function register() {}
  `);
  const features = new FeatureRegistry(dir);
  try {
    await features.load({} as HttpServer, [pathToFileURL(file).href]);
    assert.deepEqual(features.snapshot(), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
