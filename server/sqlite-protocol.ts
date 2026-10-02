import type { DatabaseRequest } from './database-types.ts';

/** Share the IPC channel with Node's watch notifications without confusing the two. */
export type SqliteQueryMessage = { type: 'sqlite:query'; filename: string; request: DatabaseRequest };
export type SqliteReply =
  | { type: 'sqlite:result'; result: unknown }
  | { type: 'sqlite:error'; error: string };
