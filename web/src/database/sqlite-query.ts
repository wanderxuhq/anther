import type { Database as DB, BindableValue } from '@sqlite.org/sqlite-wasm';
import { QueryDatabase } from './sqlite-adapter.ts';
type SQLInputValue = BindableValue;
import type { DatabaseRequest, DatabaseDescription, DatabaseObject, DatabaseRows, DatabaseCell } from './types.ts';

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const MAX_OFFSET = 100_000;
const MAX_COLUMNS = 200;
const MAX_BYTES = 1_048_576;

function object(db: QueryDatabase, target: DatabaseObject) {
  if (!target || typeof target.name !== 'string' || !['table', 'view'].includes(target.type)) throw new Error('Invalid database object');
  const row = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name=? AND type=? AND name NOT GLOB 'sqlite_*'").get(target.name, target.type);
  if (!row) throw new Error('Database object no longer exists');
  return row;
}

function describe(db: QueryDatabase, target: DatabaseObject): DatabaseDescription {
  const row = object(db, target);
  const columns = db.prepare('SELECT * FROM pragma_table_xinfo(?)').all(target.name);
  const indexes = db.prepare('SELECT * FROM pragma_index_list(?)').all(target.name);
  return {
    object: target,
    sql: row.sql as string | null,
    columns: columns.map((c) => ({ name: String(c.name), type: String(c.type), nullable: !c.notnull && !(c.pk && String(c.type).toUpperCase() === 'INTEGER' && !indexes.some((i) => i.origin === 'pk')),
      primaryKey: Number(c.pk), defaultValue: c.dflt_value as string | null, generated: Number(c.hidden) >= 2 })),
    indexes: indexes.map((i) => ({ name: String(i.name), unique: !!i.unique,
      columns: db.prepare('SELECT name FROM pragma_index_info(?)').all(String(i.name)).map((c) => c.name === null ? '(expression)' : String(c.name)),
      sql: (db.prepare('SELECT sql FROM sqlite_schema WHERE name=? AND type=\'index\'').get(String(i.name))?.sql ?? null) as string | null,
    })),
    foreignKeys: db.prepare('SELECT * FROM pragma_foreign_key_list(?)').all(target.name).map((f) => ({
      table: String(f.table), from: String(f.from), to: f.to as string | null, onUpdate: String(f.on_update), onDelete: String(f.on_delete),
    })),
  };
}

function readRows(db: QueryDatabase, input: Extract<DatabaseRequest, { action: 'rows' }>['request']): DatabaseRows {
  object(db, input.object);
  const schema = { columns: db.prepare('SELECT name,pk FROM pragma_table_xinfo(?)').all(input.object.name)
    .map((column) => ({ name: String(column.name), primaryKey: Number(column.pk) })) };
  const offset = input.offset ?? 0, limit = input.limit ?? 100;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid page');
  const columns = schema.columns.slice(0, MAX_COLUMNS);
  const validColumn = (name: string) => schema.columns.some((c) => c.name === name);
  if (input.sort && (!validColumn(input.sort.column) || !['asc', 'desc'].includes(input.sort.direction))) throw new Error('Invalid sort');
  if (input.filter && (!validColumn(input.filter.column) || typeof input.filter.value !== 'string' || input.filter.value.length > 1024)) throw new Error('Invalid filter');
  // Use an unshadowed rowid for inexpensive sequential browsing of ordinary tables.
  const table = db.prepare('SELECT wr,type FROM pragma_table_list WHERE schema=\'main\' AND name=?').get(input.object.name);
  const rowid = table?.type === 'table' && !table.wr ? ['_rowid_', 'rowid', 'oid'].find((name) => !schema.columns.some((c) => c.name.toLowerCase() === name)) : undefined;
  const seek = rowid && !input.sort ? quote(rowid) : undefined;
  if (!seek && offset > MAX_OFFSET) throw new Error('Page limit reached; narrow the filter');
  const where: string[] = [], args: SQLInputValue[] = [];
  if (input.filter && input.filter.value !== '') {
    where.push(`instr(CAST(${quote(input.filter.column)} AS TEXT), ?) > 0`);
    args.push(input.filter.value);
  }
  if (input.cursor !== undefined) {
    if (!seek || !/^-?\d{1,19}$/.test(input.cursor)) throw new Error('Invalid cursor');
    const cursor = BigInt(input.cursor);
    if (cursor < -(2n ** 63n) || cursor >= 2n ** 63n) throw new Error('Invalid cursor');
    where.push(`${seek} > ?`); args.push(cursor);
  } else if (offset > MAX_OFFSET) throw new Error('Page limit reached; narrow the filter');
  const select = columns.flatMap((c) => {
    const id = quote(c.name);
    return [`typeof(${id})`, `CASE typeof(${id}) WHEN 'blob' THEN hex(substr(${id},1,64)) WHEN 'text' THEN substr(${id},1,4096) ELSE ${id} END`,
      `CASE WHEN typeof(${id}) IN ('blob','text') THEN length(${id}) ELSE 0 END`];
  });
  if (seek) select.push(seek);
  const order = input.sort ? `${quote(input.sort.column)} ${input.sort.direction}${rowid ? `, ${quote(rowid)}` : ''}`
    : seek ?? (schema.columns.filter((c) => c.primaryKey).sort((a, b) => a.primaryKey - b.primaryKey).map((c) => quote(c.name)).join(',') || columns.map((c) => quote(c.name)).join(','));
  const statement = db.prepare(`SELECT ${select.join(',')} FROM ${quote(input.object.name)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ? OFFSET ?`);
  args.push(limit + 1, input.cursor !== undefined ? 0 : offset);
  const rows: DatabaseCell[][] = [];
  let nextCursor: string | undefined, hasMore = false, bytes = 0;
  for (const record of statement.arrays(...args)) {
    const values = record as unknown as (string | number | bigint | null)[];
    const cells: DatabaseCell[] = columns.map((_, i) => {
      const type = values[i * 3], value = values[i * 3 + 1], length = Number(values[i * 3 + 2]);
      if (type === 'null') return { type, value: null };
      if (type === 'integer') return { type, value: String(value) };
      if (type === 'real') return { type, value: Number.isFinite(Number(value)) ? Number(value) : String(value) };
      if (type === 'blob') return { type, value: String(value), bytes: length, truncated: length > 64 };
      return { type: 'text', value: String(value), truncated: length > 4096 };
    });
    const size = new TextEncoder().encode(JSON.stringify(cells)).byteLength;
    if (rows.length >= limit || (rows.length > 0 && bytes + size > MAX_BYTES)) { hasMore = true; break; }
    // A single wide row can exceed the response budget. Clip its previews further.
    if (size > MAX_BYTES) for (const cell of cells) if (cell.type === 'text' && cell.value.length > 256) { cell.value = cell.value.slice(0, 256); cell.truncated = true; }
    rows.push(cells); bytes += size;
    if (seek) nextCursor = String(values[columns.length * 3]);
  }
  return { columns: columns.map((c) => ({ key: c.name, label: c.name })), rows, offset, hasMore,
    ...(hasMore && nextCursor !== undefined ? { nextCursor } : {}), limited: schema.columns.length > MAX_COLUMNS };
}

export function queryDatabase(connection: DB, request: DatabaseRequest): unknown {
  const db = new QueryDatabase(connection);
  db.exec('BEGIN');
  try {
    if (request.action === 'objects') {
      const objects = db.prepare("SELECT name,type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name LIMIT 5001").all();
      return { objects: objects.slice(0, 5000).map((row) => ({ name: row.name, type: row.type })), truncated: objects.length > 5000 };
    }
    if (request.action === 'describe') return describe(db, request.object);
    if (request.action === 'rows') return readRows(db, request.request);
    throw new Error('Invalid database operation');
  } finally { db.exec('ROLLBACK'); }
}
