// server/routes/fs.ts
import type { HttpServer, Handler } from '../http.ts';
import type { FileStore } from '../files.ts';
import { assertWritable } from '../write-gate.ts';
import { HttpError } from '../http-error.ts';

export function registerFsRoutes(http: HttpServer, files: FileStore): void {
  // spec §5.1 API 表：服务器运行模式（只读/可写）等状态
  http.get('/api/state', async () => ({ allowWrites: true }));

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
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { content } = body as { content?: string };
    if (typeof content !== 'string') throw new HttpError(400, 'missing content');
    assertWritable(q.get('ro') ?? undefined);
    await files.write(p, content);
  });

  // spec §5.4：写操作需携带 ro=0（前端编辑模式），ro=1/缺省 → 403（与 PUT /api/file 同一裁决）。
  // body 守卫同 PUT /api/file（final-fixes 轮次修复的模式）：空 body 时 readBody 返回
  // undefined，直接解构抛 TypeError → 500；先判对象形态再解构 → 400。
  http.post('/api/mkdir', async (_req, body, q) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    assertWritable(q.get('ro') ?? undefined);
    await files.mkdir(p);
  });

  // 独占建文件（O_EXCL）：重名 → 409 already exists，不清空既有文件（与 mkdir 同裁决）
  http.post('/api/create', async (_req, body, q) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    assertWritable(q.get('ro') ?? undefined);
    await files.create(p);
  });

  http.post('/api/rename', async (_req, body, q) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { path: p, to } = body as { path?: string; to?: string };
    if (!p || !to) throw new HttpError(400, 'missing path/to');
    assertWritable(q.get('ro') ?? undefined);
    await files.rename(p, to);
  });

  http.post('/api/delete', async (_req, body, q) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    assertWritable(q.get('ro') ?? undefined);
    await files.del(p);
  });
}
