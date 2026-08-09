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
}
