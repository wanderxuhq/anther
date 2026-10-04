import type { DatabaseDescription, DatabaseObject, DatabaseRows, DatabaseRowsRequest } from './types.ts';
export type { DatabaseDescription, DatabaseObject, DatabaseRows, DatabaseRowsRequest, DatabaseCell, DatabaseSort } from './types.ts';

/** Views depend on this contract, never on a database engine or transport. */
export interface DatabaseSource {
  listObjects(signal?: AbortSignal): Promise<{ objects: DatabaseObject[]; truncated: boolean }>;
  describe(object: DatabaseObject, signal?: AbortSignal): Promise<DatabaseDescription>;
  readRows(request: DatabaseRowsRequest, signal?: AbortSignal): Promise<DatabaseRows>;
  /** Discard the current snapshot before an explicit user refresh. */
  refresh?(): void;
  dispose(): void;
}
export const isDatabaseFile = (path: string) => /\.(?:sqlite|sqlite3|db|db3)$/i.test(path);
