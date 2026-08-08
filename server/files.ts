// server/files.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HttpError } from './http-error.ts';

export type DirEntry = {
  name: string;
  type: 'file' | 'dir' | 'link';
  size: number;
  mtime: number;
};

export class FileStore {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** 规范化 + 根目录边界校验（同步、无 IO）。越界抛 400。 */
  resolve(relPath: string): string {
    if (typeof relPath !== 'string' || relPath === '') {
      throw new HttpError(400, 'invalid path');
    }
    const abs = path.resolve(this.root, relPath);
    const rootAbs = path.resolve(this.root);
    // 根为 "/" 时 rootAbs + path.sep 是 "//"，任何路径都不匹配 → 先归一化再判前缀（与 resolveSafe 同款写法）
    const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    if (abs !== rootAbs && !abs.startsWith(prefix)) {
      throw new HttpError(400, 'path escapes root');
    }
    return abs;
  }

  /**
   * 词法校验 + 真实路径（realpath）边界校验，防符号链接逃逸。
   * 从 abs 向上找最近可解析的祖先，校验其真实路径在 realpath(root) 之内，再拼接剩余部分。
   * 悬空符号链接（realpath 失败但 lstat 是链接）拒绝跟随——后续 fs 操作会写到链接目标。
   * 越界抛 400。
   */
  async resolveSafe(relPath: string): Promise<string> {
    const abs = this.resolve(relPath); // 同步词法校验，语义与 resolve() 一致
    let rootReal: string;
    try {
      rootReal = await fs.realpath(this.root);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
    // 根为 "/" 时 rootReal + path.sep 是 "//"，需规范化后再做前缀判断
    const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;

    let current = abs;
    const suffix: string[] = [];
    for (;;) {
      let real: string;
      try {
        real = await fs.realpath(current);
      } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw this.mapFsError(e);
        // current 不存在，或为悬空符号链接：悬空链接若被后续 fs 操作跟随会写到其目标，拒绝
        let isLink = false;
        try {
          isLink = (await fs.lstat(current)).isSymbolicLink();
        } catch (e2: unknown) {
          const code2 = (e2 as NodeJS.ErrnoException).code;
          if (code2 !== 'ENOENT') throw this.mapFsError(e2);
          // ENOENT：组件确实不存在，正常向上
        }
        if (isLink) {
          throw new HttpError(400, 'broken symlink');
        }
        const parent = path.dirname(current);
        if (parent === current) throw new HttpError(400, 'path escapes root');
        suffix.unshift(path.basename(current));
        current = parent;
        continue;
      }
      // 最近可解析祖先的真实路径必须在根内（abs 等于根本身时放行）
      if (real !== rootReal && !real.startsWith(rootPrefix)) {
        throw new HttpError(400, 'path escapes root');
      }
      return suffix.length === 0 ? real : path.join(real, ...suffix);
    }
  }

  async list(relPath: string): Promise<DirEntry[]> {
    const dir = await this.resolveSafe(relPath);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
    const entries: DirEntry[] = [];
    for (const name of names) {
      try {
        // lstat 不跟随符号链接，避免泄漏根外元数据；悬空链接也能正常列成 link 条目
        const st = await fs.lstat(path.join(dir, name));
        entries.push({
          name,
          type: st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'file',
          size: st.size,
          mtime: st.mtimeMs,
        });
      } catch {
        // 单条目 stat 失败（权限、竞态等）跳过该条目，不影响其余条目
      }
    }
    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async read(relPath: string): Promise<{ content: string; utf8: boolean }> {
    const abs = await this.resolveSafe(relPath);
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
    const utf8 = !this.hasInvalidUtf8(buf);
    return { content: utf8 ? buf.toString('utf8') : buf.toString('latin1'), utf8 };
  }

  async write(relPath: string, content: string): Promise<void> {
    const abs = await this.resolveSafe(relPath);
    try {
      await fs.writeFile(abs, content, 'utf8');
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  async mkdir(relPath: string): Promise<void> {
    const abs = await this.resolveSafe(relPath);
    try {
      await fs.mkdir(abs);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  async rename(relPath: string, toRel: string): Promise<void> {
    // 拒绝根路径（字面形态快速失败）；'./'、'sub/..' 等词法变体由 resolveSafeNotRoot 拦截
    if (relPath === '' || relPath === '.' || toRel === '' || toRel === '.') {
      throw new HttpError(400, 'invalid path');
    }
    const from = await this.resolveSafeNotRoot(relPath);
    const to = await this.resolveSafeNotRoot(toRel); // 目标同样过边界校验
    try {
      await fs.rename(from, to);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  async del(relPath: string): Promise<void> {
    // 拒绝根路径（字面形态快速失败）；'./'、'sub/..' 等词法变体由 resolveSafeNotRoot 拦截
    if (relPath === '' || relPath === '.') throw new HttpError(400, 'invalid path');
    const abs = await this.resolveSafeNotRoot(relPath);
    try {
      await fs.rm(abs, { recursive: true });
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  /**
   * resolveSafe + 根自身拒绝。词法变体（'./'、'sub/..'、root='/' 时的 'etc/..' 等）
   * 经 path.resolve 归一化后仍等于根，resolveSafe 对「结果等于根」显式放行
   * （list('.') 依赖），fs.rm/rename 会作用于整个根目录。resolveSafe 返回的
   * 已是 realpath 结果，与 fs.realpath(this.root) 相等即目标就是根（或指向根的
   * 符号链接）——必须在此拒绝，且发生在任何 fs 操作之前。
   */
  private async resolveSafeNotRoot(relPath: string): Promise<string> {
    const abs = await this.resolveSafe(relPath);
    if (abs === await fs.realpath(this.root)) {
      throw new HttpError(400, 'invalid path');
    }
    return abs;
  }

  private hasInvalidUtf8(buf: Buffer): boolean {
    // UTF-8 解码出现替换符（U+FFFD）即视为非 UTF-8
    return buf.toString('utf8').includes('�');
  }

  private mapFsError(e: unknown): HttpError {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return new HttpError(404, 'not found');
    if (code === 'EISDIR') return new HttpError(400, 'is a directory');
    if (code === 'EACCES' || code === 'EPERM') return new HttpError(403, 'permission denied');
    if (code === 'EEXIST') return new HttpError(409, 'already exists');
    return new HttpError(500, `filesystem error: ${code ?? 'unknown'}`);
  }
}
