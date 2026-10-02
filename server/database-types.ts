/** Transport contract: no SQLite, HTTP, or UI framework types. */
export type DatabaseObject = { name: string; type: 'table' | 'view' };
export type DatabaseColumn = { name: string; type: string; nullable: boolean; primaryKey: number; defaultValue: string | null; generated: boolean };
export type DatabaseDescription = {
  object: DatabaseObject;
  columns: DatabaseColumn[];
  indexes: { name: string; unique: boolean; columns: string[]; sql: string | null }[];
  foreignKeys: { table: string; from: string; to: string | null; onUpdate: string; onDelete: string }[];
  sql: string | null;
};
export type DatabaseCell =
  | { type: 'null'; value: null }
  | { type: 'integer'; value: string }
  | { type: 'real'; value: number | string }
  | { type: 'text'; value: string; truncated?: boolean }
  | { type: 'blob'; value: string; bytes: number; truncated?: boolean };
export type DatabaseSort = { column: string; direction: 'asc' | 'desc' };
export type DatabaseRowsRequest = {
  object: DatabaseObject;
  offset?: number;
  cursor?: string;
  limit?: number;
  sort?: DatabaseSort;
  filter?: { column: string; value: string };
};
export type DatabaseRows = {
  columns: { key: string; label: string }[];
  rows: DatabaseCell[][];
  nextCursor?: string;
  hasMore: boolean;
  offset: number;
  limited: boolean;
};
export type DatabaseRequest =
  | { action: 'objects' }
  | { action: 'describe'; object: DatabaseObject }
  | { action: 'rows'; request: DatabaseRowsRequest };
