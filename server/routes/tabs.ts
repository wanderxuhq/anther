// server/routes/tabs.ts
import type { HttpServer, Handler } from '../http.ts';
import { HttpError } from '../http-error.ts';
import type { TabStore } from '../tab-store.ts';

export function registerTabsRoutes(http: HttpServer, tabs: TabStore): void {
  const userId = (req: import('node:http').IncomingMessage): string => {
    const h = req.headers['x-user-id'];
    return typeof h === 'string' ? h : 'anon';
  };

  http.get('/api/tabs', async (req) => ({ tabs: tabs.list(), user: userId(req) }));

  const withPath =
    (fn: (userId: string, path: string) => void): Handler =>
    async (req, body) => {
      const p = (body as { path?: string }).path;
      if (typeof p !== 'string') throw new HttpError(400, 'missing path');
      fn(userId(req), p);
    };

  http.put('/api/tabs/open', withPath((u, p) => tabs.open(u, p)));
  http.put('/api/tabs/close', withPath((u, p) => tabs.close(u, p)));
  http.put('/api/tabs/front', withPath((u, p) => tabs.setFront(u, p)));

  http.put('/api/tabs/restore', async (_req, body) => {
    const paths = (body as { paths?: unknown }).paths;
    if (!Array.isArray(paths)) throw new HttpError(400, 'missing paths');
    return { restored: tabs.restore(paths.filter((x) => typeof x === 'string')) };
  });

  http.put('/api/heartbeat', async (req) => {
    tabs.heartbeat(userId(req));
  });
}
