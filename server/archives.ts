import { promises as fs, createWriteStream, type BigIntStats } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZipFile } from 'yazl';
import type { FileStore } from './files.ts';
import { HttpError } from './http-error.ts';
import { sendOpenedDownload, type ByteRange } from './download.ts';

const PREFIX = 'anther-archives-';
export type ArchiveOptions = {
  tempDir?: string;
  idleMs?: number;
  completeMs?: number;
  sweepMs?: number;
  reserveBytes?: number;
  forceZip64?: boolean;
};
export type ArchiveStatus = {
  kind: 'archive'; id: string; status: 'preparing' | 'ready' | 'failed';
  phase: 'queued' | 'scanning' | 'packing'; filename: string; size?: number; error?: string; url?: string;
};
type Entry = { rel: string; name: string; stat: BigIntStats; root?: boolean; link?: string };
type Job = {
  id: string; rel: string; filename: string; state: 'preparing' | 'ready' | 'failed';
  phase: 'queued' | 'scanning' | 'packing'; size?: number; error?: string;
  path?: string; controller: AbortController; task?: Promise<void>;
  active: number; touched: number; completeAt?: number; sent: ByteRange[];
  key: string; entries?: Entry[]; reused?: Job;
};
const version = (s: BigIntStats) => [s.dev, s.ino, s.mode, s.size, s.mtimeNs, s.ctimeNs].join(':');

/** 每次准备得到独立、不可变的 ZIP；一个 ID 下的 Range 请求始终读取同一份文件。 */
export class ArchiveManager {
  private jobs = new Map<string, Job>();
  private pending = new Map<string, Job>();
  private reusable = new Map<string, Job>();
  private garbage = new Set<string>();
  private queue: Job[] = [];
  private running = 0;
  private disposed = false;
  private cache?: Promise<string>;
  private timer?: ReturnType<typeof setInterval>;
  private sweeping?: Promise<void>;
  private readonly tempDir: string;
  private readonly idleMs: number;
  private readonly completeMs: number;
  private readonly sweepMs: number;
  private readonly reserveBytes: number;

  constructor(private files: FileStore, private options: ArchiveOptions = {}) {
    this.tempDir = options.tempDir ?? os.tmpdir();
    this.idleMs = options.idleMs ?? 30 * 60_000;
    this.completeMs = options.completeMs ?? 60_000;
    this.sweepMs = options.sweepMs ?? 30_000;
    this.reserveBytes = options.reserveBytes ?? 64 * 1024 * 1024;
  }

  private startCleanup() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.sweep().catch(() => {}); }, this.sweepMs);
    this.timer.unref();
  }

  private cacheDir(): Promise<string> {
    if (!this.cache) this.cache = (async () => {
      await fs.mkdir(this.tempDir, { recursive: true });
      await this.removeOrphans();
      const dir = await fs.mkdtemp(path.join(this.tempDir, `${PREFIX}${process.pid}-`));
      await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ app: 'anther-archives', pid: process.pid }));
      return dir;
    })();
    return this.cache;
  }

  async prepare(rel: string) {
    if (this.disposed) throw new HttpError(503, 'server is shutting down');
    const abs = await this.files.resolveSafe(rel);
    let st;
    try { st = await fs.stat(abs); }
    catch (e) { throw new HttpError((e as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 403, 'cannot read download target'); }
    if (st.isFile()) return { kind: 'file' as const, url: `/api/download?path=${encodeURIComponent(rel)}`, filename: path.basename(rel) };
    if (!st.isDirectory()) throw new HttpError(400, 'not a file or directory');
    const key = `${abs}\0${path.basename(this.files.resolve(rel))}`;
    const existing = this.pending.get(key);
    if (existing) return this.describe(existing);
    if (this.running + this.queue.length >= 8) throw new HttpError(429, 'too many archives being prepared; try again later');
    const job: Job = {
      id: randomBytes(16).toString('hex'), rel, key,
      filename: `${path.basename(this.files.resolve(rel)) || 'workspace'}.zip`,
      state: 'preparing', phase: 'queued', controller: new AbortController(),
      active: 0, touched: Date.now(), sent: [],
    };
    this.jobs.set(job.id, job);
    this.pending.set(key, job);
    this.queue.push(job);
    this.startCleanup();
    this.pump();
    return this.describe(job);
  }

  private describe(job: Job): ArchiveStatus {
    if (job.reused) return this.describe(this.get(job.reused.id));
    return {
      kind: 'archive' as const, id: job.id, status: job.state, phase: job.phase,
      filename: job.filename, size: job.size, error: job.error,
      url: job.state === 'ready' ? `/api/download/archive?id=${job.id}` : undefined,
    };
  }

  status(id: string) { return this.describe(this.get(id)); }
  private get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(410, 'archive expired; prepare the folder again');
    return job.reused ? this.get(job.reused.id) : job;
  }

  private pump() {
    while (!this.disposed && this.running < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      job.task = this.buildOrReuse(job).catch(async (e: unknown) => {
        job.state = 'failed';
        const code = (e as NodeJS.ErrnoException).code;
        job.error = code === 'ENOSPC' ? 'not enough temporary disk space' : (e as Error).message;
        if (job.path) for (const p of [job.path, `${job.path}.part`]) {
          this.garbage.add(p);
          await fs.rm(p, { force: true }).then(() => this.garbage.delete(p), () => {});
        }
      }).finally(() => {
        job.touched = Date.now();
        for (const [key, value] of this.pending) if (value === job) this.pending.delete(key);
        this.running--;
        this.pump();
      });
    }
  }

  private async buildOrReuse(job: Job) {
    const previous = this.reusable.get(job.key);
    // 校验期间钉住旧文件，清理器不能与目录扫描竞争。
    if (previous) previous.active++;
    try { await this.build(job, previous); }
    finally { if (previous) previous.active--; }
  }

  private async entryPath(rel: string, root = false) {
    if (root) return this.files.resolveSafe(rel);
    return path.join(await this.files.resolveSafe(path.dirname(rel)), path.basename(rel));
  }

  private async scan(job: Job, cache: string): Promise<Entry[]> {
    const entries: Entry[] = [];
    const rootName = job.filename.slice(0, -4);
    const visit = async (rel: string, name: string, root = false) => {
      job.controller.signal.throwIfAborted();
      // 不跟随树中的符号链接，防止越界与循环；ZIP 中保留链接本身。
      const abs = await this.entryPath(rel, root);
      // 工作区可能包含系统临时目录；排除本程序的归档缓存，避免把 ZIP 打进自己。
      if (abs === cache) return;
      const cachedName = /^anther-archives-(\d+)-[\w-]+$/.exec(path.basename(abs));
      if (path.dirname(abs) === path.dirname(cache) && cachedName) {
        const owner = await fs.readFile(path.join(abs, 'owner.json'), 'utf8').then((text) => {
          try { return JSON.parse(text) as { app?: string; pid?: number }; } catch { return undefined; }
        }, () => undefined);
        if (owner?.app === 'anther-archives' && owner.pid === Number(cachedName[1])) return;
      }
      const st = await fs.lstat(abs, { bigint: true });
      if (root && !st.isDirectory()) throw new HttpError(409, 'directory changed during preparation; retry');
      if (name.includes('\\')) throw new HttpError(400, `unsupported archive filename: ${name}`);
      if (st.isSymbolicLink()) {
        entries.push({ rel, name, stat: st, link: await fs.readlink(abs) });
      } else if (st.isDirectory()) {
        entries.push({ rel, name: `${name}/`, stat: st, root });
        const dir = await fs.opendir(await this.files.resolveSafe(rel));
        for await (const child of dir) await visit(path.join(rel, child.name), `${name}/${child.name}`);
      } else if (st.isFile()) entries.push({ rel, name, stat: st });
      else throw new HttpError(400, `cannot archive special file: ${rel}`);
    };
    // 将选中的目录解析到安全的实际路径，根目录的符号链接仍可作为目录下载。
    await visit(job.rel, rootName, true);
    return entries;
  }

  private async checkSpace(dir: string) {
    const space = await fs.statfs(dir);
    if (space.bavail * space.bsize <= this.reserveBytes) throw new HttpError(507, 'not enough temporary disk space');
  }

  private async build(job: Job, previous?: Job) {
    const cache = await this.cacheDir();
    job.controller.signal.throwIfAborted();
    job.path = path.join(cache, `${job.id}.zip`);
    const partial = `${job.path}.part`;
    job.phase = 'scanning';
    const entries = await this.scan(job, cache);
    if (previous?.entries && previous.entries.length === entries.length) {
      const prior = new Map(previous.entries.map((entry) => [entry.name, entry]));
      if (entries.every((entry) => {
        const old = prior.get(entry.name);
        return old && version(old.stat) === version(entry.stat) && old.link === entry.link;
      }) && await fs.stat(previous.path!).then((st) => st.size === previous.size, () => false)) {
        previous.touched = Date.now();
        previous.completeAt = undefined;
        previous.sent = [];
        job.path = undefined;
        job.reused = previous;
        job.state = 'ready';
        return;
      }
    }
    await this.checkSpace(cache);
    job.phase = 'packing';
    const zip = new ZipFile();
    const output = zip.outputStream as Readable;
    let active: Readable | undefined;
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      // 设置 yazl 的错误状态，停止后续条目；销毁当前源文件和输出流。
      zip.emit('error', error);
      active?.destroy(error);
      output.destroy(error);
    };
    zip.on('error', (e) => { if (!failed) fail(e); });
    const abort = () => fail(new Error('archive preparation cancelled'));
    job.controller.signal.addEventListener('abort', abort, { once: true });
    let checkedBytes = 0;
    const manager = this;
    const spaceGuard = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      checkedBytes += chunk.length;
      if (checkedBytes < 8 * 1024 * 1024) { callback(null, chunk); return; }
      checkedBytes = 0;
      void manager.checkSpace(cache).then(() => callback(null, chunk), (e) => callback(e));
    } });
    const writing = pipeline(output, spaceGuard, createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    // 注册失败处理后再添加条目，避免异步磁盘错误成为未处理的 rejection。
    void writing.catch(fail);
    try {
      job.controller.signal.throwIfAborted();
      for (const entry of entries) {
        const options = { mtime: entry.stat.mtime, mode: Number(entry.stat.mode) };
        if (entry.stat.isDirectory()) zip.addEmptyDirectory(entry.name, options);
        else if (entry.link !== undefined) zip.addBuffer(Buffer.from(entry.link), entry.name, { ...options, compress: false });
        else zip.addReadStreamLazy(entry.name, { ...options, size: Number(entry.stat.size), compressionLevel: 6 }, (callback) => {
          async function* source() {
            const opened = await manager.files.openDownload(entry.rel);
            try {
              if (version(await opened.file.stat({ bigint: true })) !== version(entry.stat)) throw new HttpError(409, `file changed during preparation: ${entry.rel}`);
              if (opened.size) yield* opened.file.createReadStream({ end: opened.size - 1, autoClose: false });
            } finally { await opened.file.close(); }
          }
          active = Readable.from(source());
          active.on('error', fail);
          callback(null, active);
        });
      }
      zip.end({ forceZip64Format: this.options.forceZip64 ?? false, comment: '' });
      await writing;
      // 发布前重新校验，发生增删或修改则失败，不提供悄悄缺文件的归档。
      for (const entry of entries) {
        job.controller.signal.throwIfAborted();
        if (version(await fs.lstat(await this.entryPath(entry.rel, entry.root), { bigint: true })) !== version(entry.stat)) {
          throw new HttpError(409, `directory changed during preparation; retry: ${job.rel}`);
        }
      }
      await fs.rename(partial, job.path);
      job.size = (await fs.stat(job.path)).size;
      job.entries = entries;
      job.state = 'ready';
      this.reusable.set(job.key, job);
    } catch (e) {
      fail(e as Error);
      await writing.catch(() => {});
      await fs.rm(partial, { force: true });
      throw e;
    } finally {
      job.controller.signal.removeEventListener('abort', abort);
    }
  }

  async download(id: string, req: IncomingMessage, res: ServerResponse) {
    const job = this.get(id);
    if (job.state !== 'ready') throw new HttpError(409, job.error ?? 'archive is not ready');
    job.active++;
    job.touched = Date.now();
    try {
      const file = await fs.open(job.path!, 'r');
      const stat = await file.stat().catch(async (e) => { await file.close(); throw e; });
      const sent = await sendOpenedDownload({ file, size: stat.size, modified: stat.mtime, etag: `"archive-${job.id}"` }, job.filename, req, res);
      if (sent && res.writableFinished) {
        const ranges = [...job.sent, ...sent].sort((a, b) => a.start - b.start);
        job.sent = [];
        for (const range of ranges) {
          const last = job.sent.at(-1);
          if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
          else job.sent.push({ ...range });
        }
        if (job.sent.length === 1 && job.sent[0].start === 0 && job.sent[0].end >= job.size! - 1) job.completeAt ??= Date.now();
      }
    } finally {
      job.active--;
      job.touched = Date.now();
    }
  }

  sweep(): Promise<void> {
    if (this.sweeping) return this.sweeping;
    this.sweeping = (async () => {
      const now = Date.now();
      for (const [id, job] of this.jobs) {
        if (job.active || job.state === 'preparing') continue;
        if (now - job.touched < this.idleMs && (!job.completeAt || now - Math.max(job.completeAt, job.touched) < this.completeMs)) continue;
        this.jobs.delete(id); // 先停止新请求，再删除；活动连接不会进入此分支。
        if (this.reusable.get(job.key) === job) this.reusable.delete(job.key);
        if (job.path) this.garbage.add(job.path);
      }
      for (const p of this.garbage) await fs.rm(p, { force: true }).then(() => this.garbage.delete(p), () => {});
      if (this.cache) await this.removeOrphans();
    })().finally(() => { this.sweeping = undefined; });
    return this.sweeping;
  }

  private async removeOrphans() {
    let names: string[];
    try { names = await fs.readdir(this.tempDir); } catch { return; }
    for (const name of names) {
      const match = /^anther-archives-(\d+)-[\w-]+$/.exec(name);
      if (!match || Number(match[1]) === process.pid) continue;
      const dir = path.join(this.tempDir, name);
      try {
        const st = await fs.lstat(dir);
        if (!st.isDirectory() || Date.now() - st.mtimeMs < this.idleMs) continue;
        const owner = JSON.parse(await fs.readFile(path.join(dir, 'owner.json'), 'utf8'));
        if (owner.app !== 'anther-archives' || owner.pid !== Number(match[1])) continue;
        try { process.kill(owner.pid, 0); continue; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
        await fs.rm(dir, { recursive: true, force: true });
      } catch { /* 不触碰不属于本应用、仍存活或不可验证的缓存。 */ }
    }
  }

  async dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.all([...this.jobs.values()].map((job) => job.task));
    await this.sweeping;
    const cache = await this.cache?.catch(() => undefined);
    if (cache) await fs.rm(cache, { recursive: true, force: true });
    this.jobs.clear();
    this.pending.clear();
    this.reusable.clear();
    this.garbage.clear();
    this.queue = [];
  }
}
