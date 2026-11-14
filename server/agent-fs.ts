// server/agent-fs.ts
// ACP client filesystem methods: agents may read and write text files inside
// the ACP session root. FileStore owns path/symlink confinement.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { RequestError } from '@agentclientprotocol/sdk';
import type { FileStore } from './files.ts';
import { HttpError } from './http-error.ts';

export type ReadTextFileParams = {
  sessionId: string;
  path: string;
  line?: number | null;
  limit?: number | null;
};

export type WriteTextFileParams = {
  sessionId: string;
  path: string;
  content: string;
};

export class AgentFileSystem {
  private readonly dir: string;
  private readonly root: string;

  constructor(
    dir: string,
    private readonly files: FileStore,
  ) {
    this.dir = path.resolve(dir);
    try {
      this.root = realpathSync(this.dir);
    } catch {
      this.root = this.dir;
    }
  }

  async readTextFile(params: ReadTextFileParams): Promise<{ content: string }> {
    const rel = this.relative(params.path);
    try {
      const result = await this.files.read(rel);
      return { content: sliceLines(result.content, params.line, params.limit) };
    } catch (error) {
      this.raise(error, params.path);
    }
  }

  async writeTextFile(params: WriteTextFileParams): Promise<Record<string, never>> {
    const rel = this.relative(params.path);
    try {
      const parent = path.posix.dirname(rel);
      if (parent !== '.' && parent !== '') await this.files.mkdir(parent, true);
      await this.files.write(rel, params.content);
      return {};
    } catch (error) {
      this.raise(error, params.path);
    }
  }

  private relative(absolute: string): string {
    if (typeof absolute !== 'string' || !path.isAbsolute(absolute)) {
      throw RequestError.invalidParams(undefined, 'path must be absolute');
    }
    const rel = inside(this.dir, absolute)
      ? path.relative(this.dir, absolute)
      : inside(this.root, absolute)
        ? path.relative(this.root, absolute)
        : undefined;
    if (rel === undefined || rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw RequestError.invalidParams(undefined, 'path escapes the workspace');
    }
    return rel.split(path.sep).join('/');
  }

  private raise(error: unknown, requestedPath: string): never {
    if (error instanceof RequestError) throw error;
    if (error instanceof HttpError) {
      if (error.status === 404) throw RequestError.resourceNotFound(requestedPath);
      throw RequestError.invalidParams(undefined, error.message);
    }
    throw RequestError.internalError(
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sliceLines(content: string, line?: number | null, limit?: number | null): string {
  if (line === undefined || line === null) {
    if (limit === undefined || limit === null) return content;
    return sliceFrom(content, 0, limit);
  }
  const start = Math.max(0, Math.floor(line) - 1);
  return sliceFrom(content, start, limit);
}

function sliceFrom(content: string, start: number, limit?: number | null): string {
  const lines = content.split('\n');
  if (start >= lines.length) return '';
  if (limit === undefined || limit === null) return lines.slice(start).join('\n');
  const count = Math.max(0, Math.floor(limit));
  return lines.slice(start, start + count).join('\n');
}
