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

  // 全局搜索（Task 17）：SSE 流式——每搜完一个有匹配的文件发一个 file 事件，
  // 结束发 done；客户端断开（req close）→ abort 遍历信号（不浪费服务端 CPU）
  http.sse('/api/search', async (req, res, q) => {
    const query = q.get('q');
    if (!query || query.trim() === '') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'missing query' })}\n\n`);
      return;
    }
    const ctrl = new AbortController();
    req.on('close', () => ctrl.abort());
    // 客户端断开后的写入会抛 EPIPE：挂在 res 上的 error 事件吞掉，防进程崩溃
    res.on('error', () => {});
    const send = (obj: unknown) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };
    // path 尾斜杠规范化：'src/' → 'src'，否则返回路径会出现 'src//a.ts'
    const relPath = (q.get('path') ?? '.').replace(/\/+$/, '');
    const result = await files.search(relPath, query.trim(), {
      caseSensitive: q.get('case') === '1',
      exclude: (q.get('exclude') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      signal: ctrl.signal,
      onFile: (path, matches) => send({ type: 'file', path, matches }),
    });
    send({
      type: 'done',
      truncated: result.truncated,
      fileCount: result.fileCount,
      matchCount: result.matchCount,
    });
  });
}
