// server/routes/fs.ts
import type { HttpServer, Handler } from '../http.ts';
import type { FileStore } from '../files.ts';
import { HttpError } from '../http-error.ts';
import { sendDownload } from '../download.ts';
import { sendImage } from '../images.ts';
import { ArchiveManager, type ArchiveOptions } from '../archives.ts';

export function registerFsRoutes(http: HttpServer, files: FileStore, archiveOptions?: ArchiveOptions): ArchiveManager {
  const archives = new ArchiveManager(files, archiveOptions);
  http.onClose(() => archives.dispose());
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

  http.getStream('/api/download', (req, res, q) => sendDownload(files, req, res, q));
  http.getStream('/api/image', (req, res, q) => sendImage(files, req, res, q));

  http.post('/api/download/prepare', (_req, body) => {
    const p = (body as { path?: unknown } | undefined)?.path;
    if (typeof p !== 'string' || !p) throw new HttpError(400, 'missing path');
    return archives.prepare(p);
  });
  http.get('/api/download/status', (_req, _body, q) => {
    const id = q.get('id');
    if (!id) throw new HttpError(400, 'missing id');
    return archives.status(id);
  });
  http.getStream('/api/download/archive', (req, res, q) => {
    const id = q.get('id');
    if (!id) throw new HttpError(400, 'missing id');
    return archives.download(id, req, res);
  });

  http.put('/api/file', async (_req, body, q) => {
    const p = q.get('path');
    if (!p) throw new HttpError(400, 'missing path');
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { content } = body as { content?: string };
    if (typeof content !== 'string') throw new HttpError(400, 'missing content');
    await files.write(p, content);
  });

  // 写操作不再校验只读：只读仅由前端编辑器控制，服务端始终放行（用户决策 2026-08-11）。
  // body 守卫同 PUT /api/file（final-fixes 轮次修复的模式）：空 body 时 readBody 返回
  // undefined，直接解构抛 TypeError → 500；先判对象形态再解构 → 400。
  http.post('/api/mkdir', async (_req, body, q) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    await files.mkdir(p);
  });

  // 独占建文件（O_EXCL）：重名 → 409 already exists，不清空既有文件（与 mkdir 同裁决）
  http.post('/api/create', async (_req, body, q) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    await files.create(p);
  });

  // 原始字节上传，不设文件大小限制；复用独占创建与根目录边界校验。
  http.postBinary('/api/upload', async (_req, body, q) => {
    const p = q.get('path');
    if (!p) throw new HttpError(400, 'missing path');
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'missing file');
    await files.create(p, body);
  });

  http.post('/api/rename', async (_req, body, q) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { path: p, to } = body as { path?: string; to?: string };
    if (!p || !to) throw new HttpError(400, 'missing path/to');
    await files.rename(p, to);
  });

  http.post('/api/delete', async (_req, body, q) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
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
  return archives;
}
