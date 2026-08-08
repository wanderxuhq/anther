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

  // spec §5.4：--rw 启动下写操作需携带 ro=0（与 PUT /api/file 同一裁决模式）
  http.post('/api/mkdir', async (_req, body, q) => {
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    gate.assertWritable(q.get('ro') ?? undefined);
    await files.mkdir(p);
  });

  http.post('/api/rename', async (_req, body, q) => {
    const { path: p, to } = body as { path?: string; to?: string };
    if (!p || !to) throw new HttpError(400, 'missing path/to');
    gate.assertWritable(q.get('ro') ?? undefined);
    await files.rename(p, to);
  });

  http.post('/api/delete', async (_req, body, q) => {
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    gate.assertWritable(q.get('ro') ?? undefined);
    await files.del(p);
  });
}
