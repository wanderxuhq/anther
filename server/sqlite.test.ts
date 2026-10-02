import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileStore } from './files.ts';
import { HttpServer } from './http.ts';
import { registerDatabaseRoutes } from './routes/database.ts';
import { SqliteService } from './sqlite.ts';
import { queryDatabase } from './sqlite-query.ts';
import { inspectFile } from './preview.ts';
import type { DatabaseDescription, DatabaseRows, DatabaseRequest } from './database-types.ts';

let root: string, db: DatabaseSync, filename: string;
const users = { name: 'users', type: 'table' } as const;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'anther-sqlite-'));
  filename = path.join(root, 'app.db');
  db = new DatabaseSync(filename);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, team INTEGER REFERENCES teams(id));
    CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
    CREATE INDEX users_name ON users(name);
    CREATE VIEW names AS SELECT name FROM users;
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<250)
    INSERT INTO users SELECT x, 'person ' || x, NULL FROM n;`);
});
afterEach(async () => { db.close(); await fs.rm(root, { recursive: true, force: true }); });

test('SQLite header detection and separate table/view metadata, including structure', async () => {
  const info = await inspectFile(new FileStore(root), 'app.db');
  assert.equal(info.kind, 'sqlite');
  const result = queryDatabase(filename, { action: 'objects' }) as { objects: unknown[] };
  assert.deepEqual(result.objects, [{ name: 'teams', type: 'table' }, users, { name: 'names', type: 'view' }]);
  const schema = queryDatabase(filename, { action: 'describe', object: users }) as DatabaseDescription;
  assert.equal(schema.columns[0].primaryKey, 1);
  assert.deepEqual(schema.indexes[0].columns, ['name']);
  assert.equal(schema.foreignKeys[0].table, 'teams');
  assert.match(schema.sql!, /CREATE TABLE users/);
});

test('rowid cursor pagination, stable sorting and bound filters', () => {
  const first = queryDatabase(filename, { action: 'rows', request: { object: users } }) as DatabaseRows;
  assert.equal(first.rows.length, 100); assert.equal(first.nextCursor, '100'); assert.equal(first.hasMore, true);
  const second = queryDatabase(filename, { action: 'rows', request: { object: users, offset: 100, cursor: first.nextCursor } }) as DatabaseRows;
  assert.equal(second.rows[0][0].value, '101'); assert.equal(second.nextCursor, '200');
  const third = queryDatabase(filename, { action: 'rows', request: { object: users, offset: 200, cursor: second.nextCursor } }) as DatabaseRows;
  assert.equal(third.rows.length, 50); assert.equal(third.hasMore, false);
  const sorted = queryDatabase(filename, { action: 'rows', request: { object: users, sort: { column: 'id', direction: 'desc' } } }) as DatabaseRows;
  assert.equal(sorted.rows[0][0].value, '250');
  const filter = queryDatabase(filename, { action: 'rows', request: { object: users, filter: { column: 'name', value: "' OR 1=1 --" } } }) as DatabaseRows;
  assert.deepEqual(filter.rows, []);
  assert.throws(() => queryDatabase(filename, { action: 'rows', request: { object: users, sort: { column: 'id; DROP TABLE users', direction: 'asc' } } }), /Invalid sort/);
});

test('preserves integer precision, NULL, empty strings and bounded text/blob previews', () => {
  db.exec('CREATE TABLE types (n INTEGER, empty TEXT, missing TEXT, body TEXT, data BLOB)');
  db.prepare('INSERT INTO types VALUES (?,?,?,?,?)').run(9223372036854775807n, '', null, '中'.repeat(100_000), new Uint8Array(2_000_000));
  const result = queryDatabase(filename, { action: 'rows', request: { object: { name: 'types', type: 'table' } } }) as DatabaseRows;
  assert.deepEqual(result.rows[0][0], { type: 'integer', value: '9223372036854775807' });
  assert.equal(result.rows[0][1].value, ''); assert.equal(result.rows[0][2].value, null);
  assert.equal(String(result.rows[0][3].value).length, 4096);
  assert.equal(result.rows[0][4].type, 'blob');
  assert.equal(String(result.rows[0][4].value).length, 128);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 20_000);
});

test('quoted names, generated columns, WITHOUT ROWID tables and views', () => {
  db.exec(`CREATE TABLE "quote\"\"/?#表" ("a\"\"" TEXT PRIMARY KEY, total INTEGER GENERATED ALWAYS AS (length("a\"\""))) WITHOUT ROWID;
    INSERT INTO "quote\"\"/?#表" ("a\"\"") VALUES ('hello'), ('world');`);
  const result = queryDatabase(filename, { action: 'rows', request: { object: { name: 'quote"/?#表', type: 'table' }, limit: 1 } }) as DatabaseRows;
  assert.equal(result.rows[0][0].value, 'hello'); assert.equal(result.rows[0][1].value, '5');
  assert.equal(result.hasMore, true); assert.equal(result.nextCursor, undefined);
  const view = queryDatabase(filename, { action: 'rows', request: { object: { name: 'names', type: 'view' }, offset: 100 } }) as DatabaseRows;
  assert.equal(view.rows[0][0].value, db.prepare('SELECT name FROM names ORDER BY name LIMIT 1 OFFSET 100').get()!.name);
  assert.throws(() => queryDatabase(filename, { action: 'rows', request: { object: { name: 'names', type: 'view' }, offset: 100_001 } }), /Page limit/);
});

test('reads committed WAL data without writing database contents', async () => {
  db.exec("PRAGMA journal_mode=WAL; INSERT INTO users VALUES (999,'WAL row',NULL)");
  const before = await fs.readFile(filename), wal = await fs.readFile(filename + '-wal');
  const service = new SqliteService(new FileStore(root));
  try {
    const result = await service.query('app.db', { action: 'rows', request: { object: users, sort: { column: 'id', direction: 'desc' } } }) as DatabaseRows;
    assert.equal(result.rows[0][0].value, '999');
    assert.deepEqual(await fs.readFile(filename), before);
    assert.deepEqual(await fs.readFile(filename + '-wal'), wal);
  } finally { await service.dispose(); }
});

test('service rejects invalid files, paths and sidecar symlinks; never creates a database', async () => {
  const service = new SqliteService(new FileStore(root));
  try {
    await assert.rejects(service.query('missing.db', { action: 'objects' }), /not found/);
    await assert.rejects(fs.stat(path.join(root, 'missing.db')));
    await fs.writeFile(path.join(root, 'fake.db'), 'plain text');
    await assert.rejects(service.query('fake.db', { action: 'objects' }), /Not a supported/);
    await assert.rejects(service.query('../outside.db', { action: 'objects' }), /escapes root/);
    await fs.symlink('/etc/passwd', filename + '-wal');
    await assert.rejects(service.query('app.db', { action: 'objects' }), /escapes root/);
  } finally { await service.dispose(); }
});

test('native long-running queries can time out or be cancelled, and subsequent requests work', async () => {
  db.exec('CREATE VIEW expensive AS WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n');
  const service = new SqliteService(new FileStore(root), 1200);
  const request: DatabaseRequest = { action: 'rows', request: { object: { name: 'expensive', type: 'view' } } };
  try {
    await assert.rejects(service.query('app.db', request), /timed out/);
    const controller = new AbortController();
    const pending = service.query('app.db', request, controller.signal);
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(pending, /cancelled/);
    const result = await service.query('app.db', { action: 'objects' }) as { objects: unknown[] };
    assert.equal(result.objects.length, 4);
  } finally { await service.dispose(); }
});

test('HTTP returns database data, validates requests and serves concurrent requests', async () => {
  const http = new HttpServer({ staticDir: root });
  registerDatabaseRoutes(http, new FileStore(root));
  http.get('/api/ping', () => ({ ok: true }));
  await http.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  try {
    const query = new URLSearchParams({ path: 'app.db', request: JSON.stringify({ action: 'objects' }) });
    const response = await fetch(`${base}/api/database?${query}`);
    assert.equal(response.status, 200); assert.equal((await response.json() as { objects: unknown[] }).objects.length, 3);
    assert.equal((await fetch(`${base}/api/database?path=app.db&request=nope`)).status, 400);
    assert.equal((await fetch(`${base}/api/database?path=app.db&request=${encodeURIComponent('{"action":"exec","sql":"DROP TABLE users"}')}`)).status, 400);
    assert.equal((await fetch(`${base}/api/ping`)).status, 200);
  } finally { await http.close(); }
});

test('watch-mode IPC notifications never become empty HTTP query responses', async () => {
  const previous = process.env.WATCH_REPORT_DEPENDENCIES;
  process.env.WATCH_REPORT_DEPENDENCIES = '1';
  const http = new HttpServer({ staticDir: root });
  registerDatabaseRoutes(http, new FileStore(root));
  try {
    await http.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const request = async (input: DatabaseRequest) => {
      const query = new URLSearchParams({ path: 'app.db', request: JSON.stringify(input) });
      const response = await fetch(`${base}/api/database?${query}`);
      const body = await response.text();
      assert.notEqual(body, '', 'a watch notification must not complete the query');
      return { status: response.status, data: JSON.parse(body) };
    };
    const listed = await request({ action: 'objects' });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.objects.length, 3);
    const described = await request({ action: 'describe', object: users });
    assert.equal(described.status, 200);
    assert.equal(described.data.columns[0].name, 'id');
    const rows = await request({ action: 'rows', request: { object: users, limit: 2 } });
    assert.equal(rows.status, 200);
    assert.equal(rows.data.rows.length, 2);
    const missing = await request({ action: 'describe', object: { name: 'missing', type: 'table' } });
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /no longer exists/);
  } finally {
    await http.close();
    if (previous === undefined) delete process.env.WATCH_REPORT_DEPENDENCIES;
    else process.env.WATCH_REPORT_DEPENDENCIES = previous;
  }
});


test('oversized computed values are rejected when Node exposes connection limits', async (t) => {
  if (!(db as DatabaseSync & { limits?: unknown }).limits) { t.skip('This Node release has no connection limits'); return; }
  db.exec('CREATE VIEW oversized AS SELECT hex(zeroblob(200000000)) AS value');
  const service = new SqliteService(new FileStore(root));
  try {
    await assert.rejects(service.query('app.db', { action: 'rows', request: { object: { name: 'oversized', type: 'view' } } }), /memory|too big/i);
  } finally { await service.dispose(); }
});
