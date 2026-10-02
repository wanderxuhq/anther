import { fork, type ChildProcess } from 'node:child_process';
import { relative } from 'node:path';
import { stat, open } from 'node:fs/promises';
import type { FileStore } from './files.ts';
import type { DatabaseRequest } from './database-types.ts';
import type { SqliteQueryMessage, SqliteReply } from './sqlite-protocol.ts';
import { HttpError } from './http-error.ts';

/** Each request owns its process/connection; cancellation also interrupts native SQLite. */
export class SqliteService {
  private running = new Set<ChildProcess>();
  private disposed = false;
  constructor(private files: FileStore, private timeoutMs = 10_000) {}

  async query(path: string, request: DatabaseRequest, signal?: AbortSignal): Promise<unknown> {
    if (Number(process.versions.node.split('.')[0]) < 24) throw new HttpError(501, 'SQLite preview requires Node.js 24 or newer');
    if (this.disposed || signal?.aborted) throw new HttpError(409, 'Database request cancelled');
    const filename = await this.files.resolveSafe(path);
    const info = await stat(filename).catch(() => { throw new HttpError(404, 'Database file not found'); });
    if (!info.isFile()) throw new HttpError(400, 'Not a database file');
    const file = await open(filename, 'r');
    try {
      const header = Buffer.alloc(16);
      await file.read(header, 0, 16, 0);
      if (header.toString() !== 'SQLite format 3\0') throw new HttpError(415, 'Not a supported SQLite database');
    } finally { await file.close(); }
    // SQLite opens sidecars itself. Check existing -wal/-shm/-journal symlinks too.
    const root = await this.files.resolveSafe('.');
    for (const suffix of ['-wal', '-shm', '-journal']) await this.files.resolveSafe(relative(root, filename + suffix));
    if (this.disposed || signal?.aborted) throw new HttpError(409, 'Database request cancelled');
    if (this.running.size >= 4) throw new HttpError(503, 'Database is busy; try again shortly');
    return new Promise((resolve, reject) => {
      const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
      const child = fork(new URL(`./sqlite-process.${extension}`, import.meta.url), [], {
        execArgv: ['--max-old-space-size=128', ...(extension === 'ts' ? ['--experimental-transform-types'] : [])],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      this.running.add(child);
      let finished = false;
      const finish = (error?: Error, result?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        child.kill('SIGKILL');
        if (error) reject(error); else resolve(result);
      };
      const abort = () => finish(new HttpError(409, 'Database request cancelled'));
      const timer = setTimeout(() => finish(new HttpError(408, 'Database query timed out; narrow the filter')), this.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      child.once('error', () => { this.running.delete(child); finish(new HttpError(500, 'Unable to start SQLite reader; Node.js 24+ is required')); });
      child.once('exit', () => { this.running.delete(child); finish(new HttpError(500, 'SQLite reader stopped')); });
      child.on('message', (message: unknown) => {
        if (!message || typeof message !== 'object' || !('type' in message)) return;
        // --watch sends watch:import / watch:require messages before our first reply.
        // Keep listening until the SQLite protocol supplies an actual result or error.
        const reply = message as SqliteReply;
        if (reply.type === 'sqlite:error') {
          finish(new HttpError(400, typeof reply.error === 'string' ? reply.error : 'SQLite reader failed'));
        } else if (reply.type === 'sqlite:result') {
          if (reply.result === undefined) finish(new HttpError(502, 'SQLite reader returned no result'));
          else finish(undefined, reply.result);
        }
      });
      child.send({ type: 'sqlite:query', filename, request } satisfies SqliteQueryMessage,
        (error) => { if (error) finish(new HttpError(500, 'Unable to start SQLite reader')); });
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.running].map((child) => new Promise<void>((resolve) => {
      child.once('exit', () => resolve()); child.kill('SIGKILL');
    })));
  }
}
