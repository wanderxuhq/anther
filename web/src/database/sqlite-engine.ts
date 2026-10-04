import type { Database as DB, Sqlite3Static } from '@sqlite.org/sqlite-wasm';

/** Import a standalone file into a private, read-only WASM allocation. */
export function openSqliteBytes(sqlite: Sqlite3Static, bytes: Uint8Array): DB {
  if (bytes.length < 100 || new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0') {
    throw new Error('Not a supported SQLite database');
  }
  if (bytes[18] === 2 || bytes[19] === 2) {
    throw new Error('WAL-mode databases need a standalone snapshot. Export a backup with journal_mode=DELETE before opening it here.');
  }
  const db = new sqlite.oo1.DB(':memory:');
  let allocation = 0;
  try {
    allocation = sqlite.wasm.allocFromTypedArray(bytes);
    const c = sqlite.capi;
    // This wrapper owns the buffer and releases it after closing SQLite.
    const result = c.sqlite3_deserialize(db.pointer!, 'main', allocation, bytes.length, bytes.length,
      c.SQLITE_DESERIALIZE_READONLY);
    if (result !== c.SQLITE_OK) throw new Error(c.sqlite3_errmsg(db.pointer!) ?? 'Unable to open SQLite database');
    c.sqlite3_limit(db.pointer!, c.SQLITE_LIMIT_LENGTH, 64 * 1024 * 1024);
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA cache_size=-8192; PRAGMA temp_store=MEMORY');
    const close = db.close.bind(db);
    db.close = () => { try { close(); } finally { if (allocation) { sqlite.wasm.dealloc(allocation); allocation = 0; } } };
    return db;
  } catch (error) {
    db.close();
    if (allocation) sqlite.wasm.dealloc(allocation);
    throw error;
  }
}
