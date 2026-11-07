import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseController } from './database/controller.ts';
import type { DatabaseRows, DatabaseRowsRequest, DatabaseSource } from './database/source.ts';
import { addDatabaseTab, databaseTabId } from './tab-model.ts';
import { DEFAULT_STATE, parseUrl, serializeUrl } from './url-state.ts';

const object = { name: '用户 /?#%" 表', type: 'table' } as const;
const target = { object, mode: 'data' } as const;
test('database tab identity includes file, object kind/name and content mode, independently of sort', () => {
  let tabs = addDatabaseTab([], 'folder/a.db', target);
  tabs = addDatabaseTab(tabs, 'folder/a.db', { ...target, mode: 'structure' });
  tabs = addDatabaseTab(tabs, 'folder/a.db', { ...target, object: { ...object, name: 'other' } });
  tabs = addDatabaseTab(tabs, 'folder/b.db', target);
  tabs = addDatabaseTab(tabs, 'folder/a.db', { ...target, object: { ...object, type: 'view' } });
  assert.equal(tabs.length, 5);
  const sort = { column: 'name', direction: 'desc' } as const;
  tabs = addDatabaseTab(tabs, 'folder/a.db', { ...target, sort });
  assert.equal(tabs.length, 5);
  assert.equal(databaseTabId('folder/a.db', { ...target, sort }), tabs[0].id);
  assert.notEqual(tabs[0].id, 'folder/a.db');
});

test('database URLs round-trip arbitrary names, modes and sort without colliding with ordinary files', () => {
  for (const mode of ['data', 'structure'] as const) {
    const database = { object, mode, ...(mode === 'data' ? { sort: { column: 'a /?#', direction: 'desc' as const } } : {}) };
    const state = { ...DEFAULT_STATE, view: 'database' as const, path: '-/database/文档 #%.db', database };
    assert.deepEqual(parseUrl('http://localhost' + serializeUrl(state)), state);
  }
  const ordinary = { ...DEFAULT_STATE, path: '-/database/a.db' };
  assert.deepEqual(parseUrl('http://localhost' + serializeUrl(ordinary)), ordinary);
  assert.equal(parseUrl('http://localhost/_/database/a.db?term=t_1&object=users').database, null);
  assert.equal(parseUrl('http://localhost/a.txt?object=users').database, null);
});

const rows = (value: string, hasMore = false): DatabaseRows => ({ columns: [{ key: 'name', label: 'name' }], rows: [[{ type: 'text', value }]], offset: 0, hasMore, nextCursor: hasMore ? '1' : undefined, limited: false });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
test('independent controllers preserve per-tab state and ignore obsolete or cancelled responses', async () => {
  const requests: { signal?: AbortSignal; result: ReturnType<typeof deferred<DatabaseRows>> }[] = [];
  let disposed = 0;
  const source: DatabaseSource = {
    listObjects: async () => ({ objects: [], truncated: false }), describe: async () => { throw new Error('unused'); },
    readRows: (_request, signal) => { const result = deferred<DatabaseRows>(); requests.push({ signal, result }); return result.promise; },
    dispose: () => { disposed++; },
  };
  const a = new DatabaseController(source, object, 'data'), b = new DatabaseController(source, { name: 'b', type: 'table' }, 'data');
  const old = a.load(); a.sort({ column: 'name', direction: 'desc' });
  assert.equal(requests[0].signal?.aborted, true);
  requests[1].result.resolve(rows('new', true)); await new Promise((r) => setTimeout(r, 0));
  requests[0].result.resolve(rows('stale')); await old;
  assert.equal(a.state.rows?.rows[0][0].value, 'new'); assert.equal(b.state.sort, undefined);
  a.next(); assert.equal(a.state.pages.length, 2); assert.equal(a.state.pages[1].cursor, '1');
  a.cancel(); assert.equal(requests[2].signal?.aborted, true); assert.equal(a.state.busy, false);
  requests[2].result.resolve(rows('cancelled')); await new Promise((r) => setTimeout(r, 0));
  assert.equal(a.state.rows?.rows[0][0].value, 'new');
  a.dispose(); b.dispose(); assert.equal(disposed, 2);
});

test('failed page navigation preserves the current page and can retry without skipping records', async () => {
  let fail = false;
  const offsets: number[] = [];
  const source: DatabaseSource = {
    listObjects: async () => ({ objects: [], truncated: false }), describe: async () => { throw new Error('unused'); },
    readRows: async (request) => {
      offsets.push(request.offset ?? 0);
      if (fail) throw new Error('read failed');
      return { ...rows(String(request.offset ?? 0), true), offset: request.offset ?? 0 };
    },
    dispose() {},
  };
  const controller = new DatabaseController(source, object, 'data');
  await controller.load();
  fail = true;
  assert.equal(await controller.next(), false);
  assert.equal(controller.state.pages.length, 1);
  assert.equal(controller.state.rows?.offset, 0);
  assert.equal(controller.state.error, 'read failed');
  fail = false;
  await controller.load();
  assert.equal(await controller.next(), true);
  assert.equal(controller.state.rows?.offset, 1);
  assert.deepEqual(offsets, [0, 1, 0, 1]);
  controller.dispose();
});

test('same-named databases in different archive levels have independent tab identities', async () => {
  const { databaseTabId } = await import('./tab-model.ts');
  const target = { object: { name: 'users', type: 'table' as const }, mode: 'data' as const };
  const ids = [databaseTabId('app.db', target), databaseTabId('bundle.zip', { ...target, archive: { entry: 'app.db', chain: [] } }),
    databaseTabId('bundle.zip', { ...target, archive: { entry: 'app.db', chain: ['inner.zip'] } }),
    databaseTabId('other.zip', { ...target, archive: { entry: 'app.db', chain: ['inner.zip'] } })];
  assert.equal(new Set(ids).size, ids.length);
});

test('restored previous pages end at the adjacent record even with variable byte-limited pages', async () => {
  const requests: DatabaseRowsRequest[] = [];
  const source: DatabaseSource = {
    listObjects: async () => ({ objects: [], truncated: false }), describe: async () => { throw new Error('unused'); },
    async readRows(request) {
      requests.push(request);
      const offset = request.offset ?? 0, count = Math.min(request.limit ?? 100, offset % 3 + 3);
      return { ...rows('', true), offset, rows: Array.from({ length: count }, (_, i) => [{ type: 'integer' as const, value: String(offset + i + 1) }]), nextCursor: String(offset + count) };
    }, dispose() {},
  };
  for (const sort of [undefined, { column: 'name', direction: 'desc' as const }]) {
    const controller = new DatabaseController(source, object, 'data', { pages: [{ offset: 21 }], sort, filter: { column: 'name', value: 'x' } });
    await controller.load();
    await controller.previous();
    assert.equal(controller.state.rows!.rows.at(-1)![0].value, '21');
    const last = controller.state.rows!.offset;
    await controller.next(); assert.equal(controller.state.rows!.offset, 21);
    await controller.previous(); assert.equal(controller.state.rows!.rows.at(-1)![0].value, '21');
    await controller.previous(); assert.equal(controller.state.rows!.rows.at(-1)![0].value, String(last));
    assert(requests.every(request => request.filter?.value === 'x'));
    controller.dispose();
  }
});

test('cancelling or failing restored backward navigation retains the current page', async () => {
  let request = 0, fail = false;
  const delayed = deferred<DatabaseRows>();
  const source: DatabaseSource = {
    listObjects: async () => ({ objects: [], truncated: false }), describe: async () => { throw new Error('unused'); },
    async readRows(input) {
      if (fail) throw new Error('read failed');
      if (++request === 3) return delayed.promise;
      return { ...rows('value', true), offset: input.offset ?? 0 };
    }, dispose() {},
  };
  const controller = new DatabaseController(source, object, 'data', { pages: [{ offset: 20 }] });
  await controller.load();
  const pending = controller.previous();
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.cancel(); delayed.resolve({ ...rows('late'), offset: 1 });
  assert.equal(await pending, false);
  assert.equal(controller.state.rows!.offset, 20); assert.equal(controller.state.pages[0].offset, 20);
  fail = true; assert.equal(await controller.previous(), false);
  assert.equal(controller.state.rows!.offset, 20); assert.equal(controller.state.pages[0].offset, 20);
  controller.dispose();
});
