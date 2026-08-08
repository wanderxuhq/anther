// server/http.ts
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http-error.ts';

export type Handler = (
  req: IncomingMessage,
  body: unknown,
  query: URLSearchParams,
) => Promise<unknown> | unknown;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export class HttpServer {
  private routes = new Map<string, Map<string, Handler>>();
  private server = createServer((req, res) => void this.handle(req, res));
  private staticDir: string;

  constructor(opts: { staticDir: string }) {
    this.staticDir = opts.staticDir;
  }

  get(pattern: string, h: Handler) { this.add('GET', pattern, h); }
  put(pattern: string, h: Handler) { this.add('PUT', pattern, h); }
  post(pattern: string, h: Handler) { this.add('POST', pattern, h); }

  private add(method: string, pattern: string, h: Handler) {
    if (!this.routes.has(method)) this.routes.set(method, new Map());
    this.routes.get(method)!.set(pattern, h);
  }

  async listen(port: number, host: string) {
    return new Promise<void>((resolve) => this.server.listen(port, host, resolve));
  }
  close() {
    return new Promise<void>((resolve, reject) =>
      this.server.close((e) => (e ? reject(e) : resolve())),
    );
  }
  address() { return this.server.address(); }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        await this.serveStatic(url.pathname, res);
        return;
      }
      const handler = this.routes.get(req.method ?? '')?.get(url.pathname);
      if (!handler) throw new HttpError(404, 'not found');
      const body = await readBody(req);
      const result = await handler(req, body, url.searchParams);
      res.json(result ?? { ok: true });
    } catch (e: unknown) {
      if (e instanceof HttpError) {
        res.json({ error: e.message }, e.status);
      } else {
        res.json({ error: 'internal error' }, 500);
      }
    }
  }

  /** 静态资源 + SPA fallback：存在则返回文件，否则返回 index.html */
  private async serveStatic(urlPath: string, res: ServerResponse) {
    const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
    const abs = path.resolve(this.staticDir, rel);
    if (!abs.startsWith(path.resolve(this.staticDir) + path.sep) && rel !== 'index.html') {
      throw new HttpError(400, 'bad path');
    }
    let content: Buffer;
    try {
      content = await readFile(abs);
    } catch {
      // SPA fallback：任意路径都回 index.html
      content = await readFile(path.join(this.staticDir, 'index.html'));
    }
    const ext = path.extname(abs);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': content.length,
    });
    res.end(content);
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}
