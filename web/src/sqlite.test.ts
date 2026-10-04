import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import init, { type Database as DB } from '@sqlite.org/sqlite-wasm';
import { queryDatabase } from './database/sqlite-query.ts';
import { openSqliteBytes } from './database/sqlite-engine.ts';
import type { DatabaseDescription, DatabaseRows } from './database/types.ts';
const sqlite = await init();
let db: DB;
const users = { name: 'users', type: 'table' } as const;
beforeEach(() => {
  db = new sqlite.oo1.DB(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, team INTEGER REFERENCES teams(id));
    CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
    CREATE INDEX users_name ON users(name);
    CREATE VIEW names AS SELECT name FROM users;
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<250)
    INSERT INTO users SELECT x, 'person ' || x, NULL FROM n;`);
});
afterEach(() => db.close());
test('SQLite header detection and separate table/view metadata, including structure', async () => {
  const result = queryDatabase(db, { action: 'objects' }) as { objects: unknown[] };
  assert.deepEqual(result.objects, [{ name: 'teams', type: 'table' }, users, { name: 'names', type: 'view' }]);
  const schema = queryDatabase(db, { action: 'describe', object: users }) as DatabaseDescription;
  assert.equal(schema.columns[0].primaryKey, 1);
  assert.deepEqual(schema.indexes[0].columns, ['name']);
  assert.equal(schema.foreignKeys[0].table, 'teams');
  assert.match(schema.sql!, /CREATE TABLE users/);
});

test('rowid cursor pagination, stable sorting and bound filters', () => {
  const first = queryDatabase(db, { action: 'rows', request: { object: users } }) as DatabaseRows;
  assert.equal(first.rows.length, 100); assert.equal(first.nextCursor, '100'); assert.equal(first.hasMore, true);
  const second = queryDatabase(db, { action: 'rows', request: { object: users, offset: 100, cursor: first.nextCursor } }) as DatabaseRows;
  assert.equal(second.rows[0][0].value, '101'); assert.equal(second.nextCursor, '200');
  const third = queryDatabase(db, { action: 'rows', request: { object: users, offset: 200, cursor: second.nextCursor } }) as DatabaseRows;
  assert.equal(third.rows.length, 50); assert.equal(third.hasMore, false);
  const sorted = queryDatabase(db, { action: 'rows', request: { object: users, sort: { column: 'id', direction: 'desc' } } }) as DatabaseRows;
  assert.equal(sorted.rows[0][0].value, '250');
  const filter = queryDatabase(db, { action: 'rows', request: { object: users, filter: { column: 'name', value: "' OR 1=1 --" } } }) as DatabaseRows;
  assert.deepEqual(filter.rows, []);
  assert.throws(() => queryDatabase(db, { action: 'rows', request: { object: users, sort: { column: 'id; DROP TABLE users', direction: 'asc' } } }), /Invalid sort/);
});

test('preserves integer precision, NULL, empty strings and bounded text/blob previews', () => {
  db.exec('CREATE TABLE types (n INTEGER, empty TEXT, missing TEXT, body TEXT, data BLOB)');
  db.exec({ sql: 'INSERT INTO types VALUES (?,?,?,?,?)', bind: [9223372036854775807n, '', null, '中'.repeat(100_000), new Uint8Array(2_000_000)] });
  const result = queryDatabase(db, { action: 'rows', request: { object: { name: 'types', type: 'table' } } }) as DatabaseRows;
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
  const result = queryDatabase(db, { action: 'rows', request: { object: { name: 'quote"/?#表', type: 'table' }, limit: 1 } }) as DatabaseRows;
  assert.equal(result.rows[0][0].value, 'hello'); assert.equal(result.rows[0][1].value, '5');
  assert.equal(result.hasMore, true); assert.equal(result.nextCursor, undefined);
  const view = queryDatabase(db, { action: 'rows', request: { object: { name: 'names', type: 'view' }, offset: 100 } }) as DatabaseRows;
  assert.equal(view.rows[0][0].value, db.selectValue('SELECT name FROM names ORDER BY name LIMIT 1 OFFSET 100'));
  assert.throws(() => queryDatabase(db, { action: 'rows', request: { object: { name: 'names', type: 'view' }, offset: 100_001 } }), /Page limit/);
});


test('imports a private read-only snapshot, preserves source bytes and frees statements', () => {
  const bytes = sqlite.capi.sqlite3_js_db_export(db.pointer!);
  const before = bytes.slice();
  const imported = openSqliteBytes(sqlite, bytes);
  try {
    assert.equal((queryDatabase(imported, { action: 'rows', request: { object: users } }) as DatabaseRows).rows.length, 100);
    assert.throws(() => imported.exec('DROP TABLE users'), /readonly|read-only/i);
    assert.throws(() => queryDatabase(imported, { action: 'describe', object: { name: 'missing', type: 'table' } }), /no longer exists/);
    assert.ok(queryDatabase(imported, { action: 'objects' }));
    assert.equal(imported.openStatementCount(), 0);
    assert.deepEqual(bytes, before);
  } finally { imported.close(); imported.close(); }
});

test('invalid files and WAL snapshots are rejected before import', () => {
  assert.throws(() => openSqliteBytes(sqlite, new Uint8Array(100)), /Not a supported/);
  const bytes = sqlite.capi.sqlite3_js_db_export(db.pointer!);
  bytes[18] = bytes[19] = 2;
  assert.throws(() => openSqliteBytes(sqlite, bytes), /WAL-mode.*snapshot/);
});

test('computed values have a native SQLite allocation bound', () => {
  db.exec('CREATE VIEW oversized AS SELECT hex(zeroblob(200000000)) AS value');
  const imported = openSqliteBytes(sqlite, sqlite.capi.sqlite3_js_db_export(db.pointer!));
  try {
    assert.throws(() => queryDatabase(imported, { action: 'rows', request: { object: { name: 'oversized', type: 'view' } } }), /too big/i);
  } finally { imported.close(); }
});
