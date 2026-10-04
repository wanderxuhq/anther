import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteSource } from './database/sqlite-source.ts';

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: any[] = [];
  terminated = false;
  onmessage?: (event: any) => void;
  onerror?: (event: any) => void;
  onmessageerror?: () => void;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: any) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(type: string, result?: unknown) {
    this.onmessage?.({ data: { id: this.messages.at(-1).id, type, result, error: type === 'error' ? 'Invalid database' : undefined } });
  }
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
beforeEach((t) => {
  FakeWorker.instances = [];
  for (const [name, value] of Object.entries({ Worker: FakeWorker, location: { href: 'http://localhost/' }, localStorage: { getItem: () => 'test-user' } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete (globalThis as any)[name]; });
  }
});

test('tree and table share a worker, serialize queries and release it after the last source', async (t) => {
  const a = createSqliteSource('app #.db'), b = createSqliteSource('app #.db');
  t.after(() => { a.dispose(); b.dispose(); });
  const first = a.listObjects(), second = b.describe({ name: 'users', type: 'table' });
  assert.equal(FakeWorker.instances.length, 1);
  const worker = FakeWorker.instances[0];
  assert.equal(worker.messages.length, 1);
  assert.equal(new URL(worker.messages[0].url).pathname, '/api/download');
  assert.equal(new URL(worker.messages[0].url).searchParams.get('path'), 'app #.db');
  const result = { objects: [{ name: 'users', type: 'table' }], truncated: false };
  worker.reply('result', result);
  assert.deepEqual(await first, result);
  await tick();
  assert.equal(worker.messages.length, 2);
  worker.reply('result', { columns: [] });
  await second;
  a.dispose(); await tick(); assert.equal(worker.terminated, false);
  b.dispose(); await tick(); assert.equal(worker.terminated, true);
});

test('cancelling a running query terminates WASM and queued queries restart safely', async (t) => {
  const source = createSqliteSource('cancel.db'); t.after(() => source.dispose());
  const cancel = new AbortController();
  const first = source.listObjects(cancel.signal);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = source.listObjects();
  const old = FakeWorker.instances[0];
  cancel.abort(); await rejected; await tick();
  assert.equal(old.terminated, true);
  const current = FakeWorker.instances[1];
  old.reply('result', { stale: true });
  current.reply('result', { objects: [], truncated: false });
  assert.deepEqual(await second, { objects: [], truncated: false });
});

test('cancelling a queued query does not stop a different active reader', async (t) => {
  const source = createSqliteSource('queued.db'); t.after(() => source.dispose());
  const first = source.listObjects();
  const cancel = new AbortController();
  const second = source.listObjects(cancel.signal);
  const rejected = assert.rejects(second, { name: 'AbortError' });
  cancel.abort(); await rejected;
  const worker = FakeWorker.instances[0];
  assert.equal(worker.terminated, false);
  worker.reply('result', { objects: [] }); await first;
  await tick(); assert.equal(worker.messages.length, 1);
});

test('refresh drops the snapshot; disposing rejects pending work and prevents further queries', async (t) => {
  const source = createSqliteSource('refresh.db'); t.after(() => source.dispose());
  const first = source.listObjects(); FakeWorker.instances[0].reply('result', { objects: [] }); await first;
  source.refresh!(); assert.equal(FakeWorker.instances[0].terminated, true);
  const second = source.listObjects();
  assert.equal(FakeWorker.instances.length, 2);
  const rejected = assert.rejects(second, { name: 'AbortError' });
  source.dispose(); await rejected; await tick();
  assert.equal(FakeWorker.instances[1].terminated, true);
  await assert.rejects(source.listObjects(), { name: 'AbortError' });
});

test('query timeout kills the worker and the next request can recover', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = createSqliteSource('timeout.db'); t.after(() => source.dispose());
  const pending = source.listObjects();
  const worker = FakeWorker.instances[0]; worker.reply('querying');
  const rejected = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(10_001); await rejected;
  assert.equal(worker.terminated, true);
  const retry = source.listObjects(); FakeWorker.instances[1].reply('result', { objects: [] }); await retry;
});

test('worker errors reject immediately and allow a fresh worker on retry', async (t) => {
  const source = createSqliteSource('broken.db'); t.after(() => source.dispose());
  const pending = source.listObjects();
  const rejected = assert.rejects(pending, /WASM failed/);
  FakeWorker.instances[0].onerror!({ message: 'WASM failed', preventDefault() {} });
  await rejected;
  const retry = source.listObjects(); FakeWorker.instances[1].reply('result', { objects: [] }); await retry;
});

test('archive blobs go directly to the worker and keep their lease until release', async (t) => {
  let releases = 0, loads = 0;
  const blob = new Blob(['SQLite data']);
  const source = createSqliteSource({ key: 'archive-entry', load: async () => { loads++; return { blob, release() { releases++; } }; } });
  t.after(() => source.dispose());
  const first = source.listObjects(); await tick();
  const worker = FakeWorker.instances[0];
  assert.equal(worker.messages[0].blob, blob);
  assert.equal(worker.messages[0].url, undefined);
  worker.reply('result', { objects: [] }); await first;
  const second = source.listObjects(); await tick();
  assert.equal(worker.messages[1].blob, undefined);
  worker.reply('result', { objects: [] }); await second;
  assert.equal(loads, 1); assert.equal(releases, 0);
  source.dispose(); await tick(); await tick();
  assert.equal(releases, 1);
});

test('closing during extraction releases late blobs without starting a worker', async () => {
  let releases = 0, resolve!: (value: { blob: Blob; release(): void }) => void;
  const source = createSqliteSource({ key: 'late-entry', load: () => new Promise((r) => { resolve = r; }) });
  const pending = source.listObjects(), rejected = assert.rejects(pending, { name: 'AbortError' });
  source.dispose(); await rejected;
  resolve({ blob: new Blob(['late']), release() { releases++; } });
  await tick(); await tick();
  assert.equal(FakeWorker.instances.length, 0); assert.equal(releases, 1);
});
