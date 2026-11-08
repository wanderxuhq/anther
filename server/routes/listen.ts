// server/routes/listen.ts
// 运行时切换监听地址：GET 返回当前 host/port，POST 热切换到指定 host。
import type { Router } from '../http.ts';
import { HttpError } from '../http-error.ts';
import { isLoopbackHost, isValidHost } from '../host.ts';

export type ListenState = { host: string; port: number; mode: 'local' | 'lan' };

function stateOf(info: { host: string; port: number }): ListenState {
  return { ...info, mode: isLoopbackHost(info.host) ? 'local' : 'lan' };
}

export function registerListenRoute(
  router: Router,
  current: () => { host: string; port: number } | null,
  rebind: (host: string) => Promise<{ host: string; port: number }>,
): void {
  router.get('/api/anther/listen', () => {
    const info = current();
    if (!info) throw new HttpError(503, 'server is not listening');
    return stateOf(info);
  });

  router.post('/api/anther/listen', async (_req, body) => {
    const host = (body as { host?: unknown } | null | undefined)?.host;
    if (!isValidHost(host)) throw new HttpError(400, 'invalid host');
    return stateOf(await rebind(host));
  });
}
