// server/files.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HttpError } from './http-error.ts';

export type DirEntry = {
  name: string;
  type: 'file' | 'dir';
  size: number;
  mtime: number;
};

export class FileStore {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** 规范化 + 根目录边界校验。越界抛 400。 */
  resolve(relPath: string): string {
    if (typeof relPath !== 'string' || relPath === '') {
      throw new HttpError(400, 'invalid path');
    }
    const abs = path.resolve(this.root, relPath);
    const rootAbs = path.resolve(this.root);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
      throw new HttpError(400, 'path escapes root');
    }
    return abs;
  }

  async list(relPath: string): Promise<DirEntry[]> {
    const dir = this.resolve(relPath);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
    const entries = await Promise.all(
      names.map(async (name): Promise<DirEntry> => {
        const st = await fs.stat(path.join(dir, name));
        return {
          name,
          type: st.isDirectory() ? 'dir' : 'file',
          size: st.size,
          mtime: st.mtimeMs,
        };
      }),
    );
    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async read(relPath: string): Promise<{ content: string; utf8: boolean }> {
    const abs = this.resolve(relPath);
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
    const abs = this.resolve(relPath);
    try {
      await fs.writeFile(abs, content, 'utf8');
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  async mkdir(relPath: string): Promise<void> {
    const abs = this.resolve(relPath);
    try {
      await fs.mkdir(abs);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  async rename(relPath: string, toRel: string): Promise<void> {
    const from = this.resolve(relPath);
    const to = this.resolve(toRel); // 目标同样过边界校验
    try {
      await fs.rename(from, to);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  async del(relPath: string): Promise<void> {
    const abs = this.resolve(relPath);
    try {
      await fs.rm(abs, { recursive: true });
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
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
