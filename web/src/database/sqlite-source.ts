import { api, getUserId } from '../api.ts';
import type { DatabaseSource } from './source.ts';
import type { DatabaseRequest } from './types.ts';

export type SqliteInput = { key: string; url?: string; headers?: Record<string, string>; load?: () => Promise<{ blob: Blob; release(): void }> };
const abortError = () => new DOMException('Database request cancelled', 'AbortError');
type Job = {
  id: number; request: DatabaseRequest; signal?: AbortSignal; cancel(): void;
  resolve(result: unknown): void; reject(error: Error): void;
};
const sessions = new Map<string, Session>();
let sequence = 0;

/** One worker per open file; tree and active table share the downloaded snapshot. */
class Session {
  references = 0;
  private worker?: Worker;
  private generation = 0;
  private queue: Job[] = [];
  private active?: Job;
  private timer?: ReturnType<typeof setTimeout>;
  private material?: ReturnType<NonNullable<SqliteInput['load']>>;
  constructor(readonly input: SqliteInput) {}
  request(request: DatabaseRequest, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const job: Job = { id: ++sequence, request, signal, resolve, reject, cancel: () => {
        if (this.active === job) { this.stopWorker(); this.finish(job, abortError()); }
        else { this.queue = this.queue.filter((item) => item !== job); job.signal?.removeEventListener('abort', job.cancel); reject(abortError()); }
      } };
      signal?.addEventListener('abort', job.cancel, { once: true });
      this.queue.push(job); void this.pump();
    });
  }
  private stopWorker() {
    this.generation++;
    this.worker?.terminate(); this.worker = undefined; clearTimeout(this.timer);
    const material = this.material; this.material = undefined;
    void material?.then((value) => value.release(), () => {});
  }
  private deadline(job: Job, ms: number) {
    clearTimeout(this.timer);
    const generation = this.generation;
    this.timer = setTimeout(() => {
      if (this.active !== job || this.generation !== generation) return;
      this.stopWorker(); this.finish(job, new Error('SQLite operation timed out. Retry or narrow the filter.'));
    }, ms);
  }
  private async pump() {
    if (this.active || !this.queue.length) return;
    const job = this.active = this.queue.shift()!;
    const generation = this.generation;
    try {
      let blob: Blob | undefined;
      if (!this.worker && this.input.load) {
        const material = this.material = this.input.load();
        const value = await material;
        if (this.active !== job || this.generation !== generation || this.material !== material) return;
        blob = value.blob;
      }
      if (!this.worker) {
        const worker = this.worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event) => {
          if (worker !== this.worker) return;
          const current = this.active, reply = event.data;
          if (!current || reply.id !== current.id) return;
          if (reply.type === 'loading') this.deadline(current, 60_000);
          else if (reply.type === 'querying') this.deadline(current, 10_000);
          else if (reply.type === 'result') this.finish(current, undefined, reply.result);
          else this.finish(current, new Error(reply.error || 'Unable to read SQLite database'));
        };
        worker.onerror = (event) => {
          event.preventDefault();
          if (worker !== this.worker) return;
          const current = this.active;
          this.stopWorker();
          if (current) this.finish(current, new Error(event.message || 'SQLite worker failed'));
        };
        worker.onmessageerror = () => {
          if (worker !== this.worker) return;
          const current = this.active;
          this.stopWorker();
          if (current) this.finish(current, new Error('Unable to receive SQLite results'));
        };
      }
      this.deadline(job, 60_000);
      this.worker.postMessage({ id: job.id, request: job.request, url: this.input.url, headers: this.input.headers, blob });
    } catch (error) { if (this.active === job && this.generation === generation) { this.stopWorker(); this.finish(job, error as Error); } }
  }
  private finish(job: Job, error?: Error, result?: unknown) {
    if (this.active !== job) return;
    clearTimeout(this.timer); this.active = undefined;
    job.signal?.removeEventListener('abort', job.cancel);
    if (error) job.reject(error); else job.resolve(result);
    queueMicrotask(() => this.pump());
  }
  reset() {
    this.stopWorker();
    // Refresh the shared snapshot without cancelling another consumer's request.
    if (this.active) {
      const job = this.active;
      this.active = undefined;
      job.id = ++sequence;
      this.queue.unshift(job);
    }
    void this.pump();
  }
  release() {
    this.references--;
    // Allow a tab-to-tab handoff before releasing the entire WASM heap.
    queueMicrotask(() => {
      if (this.references || sessions.get(this.input.key) !== this) return;
      sessions.delete(this.input.key); this.reset();
    });
  }
}

export function createSqliteSource(path: string | SqliteInput): DatabaseSource {
  const input: SqliteInput = typeof path === 'string'
    ? { key: path, url: new URL(api.downloadUrl(path), globalThis.location.href).href, headers: { 'x-user-id': getUserId() } } : path;
  let session = sessions.get(input.key);
  if (!session) { session = new Session(input); sessions.set(input.key, session); }
  session.references++;
  const pending = new Set<AbortController>();
  let disposed = false;
  async function request<T>(body: DatabaseRequest, signal?: AbortSignal): Promise<T> {
    if (disposed || signal?.aborted) throw abortError();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true }); pending.add(controller);
    try { return await session!.request(body, controller.signal) as T; }
    finally { pending.delete(controller); signal?.removeEventListener('abort', cancel); }
  }
  return {
    listObjects: (signal) => request({ action: 'objects' }, signal),
    describe: (object, signal) => request({ action: 'describe', object }, signal),
    readRows: (input, signal) => request({ action: 'rows', request: input }, signal),
    refresh() { if (!disposed) session!.reset(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of pending) controller.abort();
      pending.clear(); session!.release();
    },
  };
}
