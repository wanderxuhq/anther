import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database as DB } from '@sqlite.org/sqlite-wasm';
import { openSqliteBytes } from './sqlite-engine.ts';
import { queryDatabase } from './sqlite-query.ts';
import type { DatabaseRequest } from './types.ts';

let database: DB | undefined;
self.onmessage = async (event: MessageEvent<{ id: number; url?: string; blob?: Blob; headers?: Record<string, string>; request: DatabaseRequest }>) => {
  const { id, request, url, headers, blob } = event.data;
  try {
    if (!database) {
      const response = blob ? new Response(blob) : await fetch(url!, { headers, cache: 'no-store' });
      if (!response.ok) throw new Error(`Unable to download SQLite database (HTTP ${response.status})`);
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (!response.body) throw new Error('SQLite download has no content');
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); length += value.length;
        self.postMessage({ id, type: 'loading' });
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      chunks.length = 0;
      self.postMessage({ id, type: 'loading' });
      const sqlite = await sqlite3InitModule();
      database = openSqliteBytes(sqlite, bytes);
    }
    self.postMessage({ id, type: 'querying' });
    self.postMessage({ id, type: 'result', result: queryDatabase(database, request) });
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
