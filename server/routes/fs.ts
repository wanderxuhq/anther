// server/routes/fs.ts
import type { HttpServer, Handler } from '../http.ts';
import type { FileStore } from '../files.ts';
import type { WriteGate } from '../write-gate.ts';
import { HttpError } from '../http-error.ts';

export function registerFsRoutes(
  http: HttpServer,
  files: FileStore,
  gate: WriteGate,
): void {
  http.get('/api/list', async (_req, _body, q) => {
    return { entries: await files.list(q.get('path') ?? '.') };
  });

  http.get('/api/file', async (_req, _body, q) => {
    const p = q.get('path');
    if (!p) throw new HttpError(400, 'missing path');
    return await files.read(p);
  });

  http.put('/api/file', async (_req, body, q) => {
    const p = q.get('path');
    if (!p) throw new HttpError(400, 'missing path');
    const { content } = body as { content?: string };
    if (typeof content !== 'string') throw new HttpError(400, 'missing content');
    gate.assertWritable(q.get('ro') ?? undefined);
    await files.write(p, content);
  });

  http.post('/api/mkdir', async (_req, body) => {
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    gate.assertWritable();
    await files.mkdir(p);
  });

  http.post('/api/rename', async (_req, body) => {
    const { path: p, to } = body as { path?: string; to?: string };
    if (!p || !to) throw new HttpError(400, 'missing path/to');
    gate.assertWritable();
    await files.rename(p, to);
  });

  http.post('/api/delete', async (_req, body) => {
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    gate.assertWritable();
    await files.del(p);
  });
}
