// server/routes/git.ts
import type { HttpServer } from '../http.ts';
import { HttpError } from '../http-error.ts';
import type { Git } from '../git.ts';

export function registerGitRoutes(http: HttpServer, git: Git): void {
  http.get('/api/git/status', async () => git.status());

  http.get('/api/git/diff', async (_req, _body, query) => {
    const p = query.get('path');
    if (!p) throw new HttpError(400, 'missing path');
    return { diff: await git.diff(p) };
  });

  http.post('/api/git/commit', async (_req, body) => {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { paths?: unknown; message?: unknown };
    if (!Array.isArray(b.paths) || b.paths.some((x) => typeof x !== 'string')) {
      throw new HttpError(400, 'invalid paths');
    }
    if (typeof b.message !== 'string') throw new HttpError(400, 'invalid message');
    await git.commit(b.paths as string[], b.message);
    return { ok: true };
  });

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
