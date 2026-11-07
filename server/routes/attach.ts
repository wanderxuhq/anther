// server/routes/attach.ts
// 命令行附加：宿主主端口上的 loopback-only POST。
// 不是独立 IPC 端口/文件；只接受本机回环来源，LAN 客户端无法调用。
import type { IncomingMessage } from 'node:http';
import type { Router } from '../http.ts';
import { HttpError } from '../http-error.ts';
import type { MountRegistry } from '../mounts.ts';

export const ATTACH_PATH = '/api/anther/attach';

/** 127.0.0.1 / ::1 / ::ffff:127.0.0.1；仅用于附加接口。 */
export function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

export function registerAttachRoute(
  http: Router,
  registry: MountRegistry,
  enabled: () => boolean,
): void {
  http.post(ATTACH_PATH, async (req, body) => {
    if (!isLoopback(req)) throw new HttpError(403, 'attach is loopback-only');
    if (!enabled()) throw new HttpError(403, 'attach is disabled');
    const workspace = (body as { workspace?: unknown } | undefined)?.workspace;
    if (typeof workspace !== 'string' || workspace === '') {
      throw new HttpError(400, 'missing workspace');
    }
    try {
      return await registry.attach(workspace);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : 'attach failed');
    }
  });
}
