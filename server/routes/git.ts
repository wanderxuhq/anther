// server/routes/git.ts
import type { Router } from '../http.ts';
import { HttpError } from '../http-error.ts';
import type { Git } from '../git.ts';

/** paths 缺省视为空数组（提交已暂存内容）；提供了就必须是字符串数组。 */
function readPaths(body: unknown): string[] {
  const raw = (typeof body === 'object' && body !== null ? (body as { paths?: unknown }).paths : undefined);
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string')) throw new HttpError(400, 'invalid paths');
  return raw as string[];
}

function requirePaths(body: unknown): string[] {
  const paths = readPaths(body);
  if (paths.length === 0) throw new HttpError(400, 'invalid paths');
  return paths;
}

export function registerGitRoutes(http: Router, git: Git): void {
  http.get('/api/git/status', async () => git.status());

  http.get('/api/git/diff', async (_req, _body, query) => {
    const p = query.get('path');
    if (!p) throw new HttpError(400, 'missing path');
    return { diff: await git.diff(p) };
  });

  http.post('/api/git/commit', async (_req, body) => {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { paths?: unknown; message?: unknown; amend?: unknown };
    const paths = readPaths(body);
    if (typeof b.message !== 'string') throw new HttpError(400, 'invalid message');
    await git.commit(paths, b.message, b.amend === true);
    return { ok: true };
  });

  http.post('/api/git/stage', async (_req, body) => {
    await git.stage(requirePaths(body));
    return { ok: true };
  });

  http.post('/api/git/unstage', async (_req, body) => {
    await git.unstage(requirePaths(body));
    return { ok: true };
  });

  http.post('/api/git/discard', async (_req, body) => {
    await git.discard(requirePaths(body));
    return { ok: true };
  });

  http.post('/api/git/fetch', async () => git.fetch());
  http.post('/api/git/pull', async () => git.pull());
  http.post('/api/git/push', async () => git.push());

  http.get('/api/git/branches', async () => git.branches());

  http.get('/api/git/log', async (_req, _body, query) => {
    const branch = query.get('branch');
    const limitRaw = query.get('limit');
    const skipRaw = query.get('skip');
    return git.log(branch, limitRaw === null ? 50 : Number(limitRaw), skipRaw === null ? 0 : Number(skipRaw));
  });

  http.get('/api/git/show', async (_req, _body, query) => {
    const c = query.get('commit');
    if (!c) throw new HttpError(400, 'missing commit');
    return git.show(c);
  });

  http.post('/api/git/checkout', async (_req, body) => {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { name?: unknown };
    if (typeof b.name !== 'string') throw new HttpError(400, 'invalid name');
    await git.checkout(b.name);
    const { current } = await git.branches();
    return { current };
  });

  http.post('/api/git/create-branch', async (_req, body) => {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { name?: unknown };
    if (typeof b.name !== 'string') throw new HttpError(400, 'invalid name');
    await git.createBranch(b.name);
    const { current } = await git.branches();
    return { current };
  });
}
