// server/cli.ts
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { HttpServer, Router } from './http.ts';
import { createWorkspace, registerWorkspaceRoutes } from './workspace.ts';
import { MountRegistry, canonicalDir, isSameWorkspace } from './mounts.ts';
import { ATTACH_PATH, DETACH_PATH, registerAttachRoute, registerDetachRoute } from './routes/attach.ts';
import { registerIdentifyRoutes } from './routes/identify.ts';
import { registerListenRoute } from './routes/listen.ts';
import type { AppIdentity } from './app-info.ts';
import type { AttachInfo, MountWire } from './mount-types.ts';
import { isLoopbackHost, isValidHost, isWildcardHost } from './host.ts';

export type CliArgs = { dir: string; port: number; host: string; attach: boolean; detach: boolean };

/**
 * 静态目录解析：源码形态（server/cli.ts）→ <root>/web；编译产物（dist/server/cli.js）
 * → <root>/dist/web。不能用 import.meta.dirname + '../dist/web'：产物中该值 = dist/server，
 * 会解析成 dist/dist/web（不存在）→ 生产模式静态资源全 500。
 */
export function staticDirFor(moduleUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../web');
}

export function parseArgs(argv: string[]): CliArgs {
  let dir = process.cwd();
  let port = 3000;
  let host = '127.0.0.1';
  let attach = true;
  let detach = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      const raw = argv[++i];
      if (!raw || !/^\d+$/.test(raw)) throw new Error('invalid --port');
      port = Number(raw);
      continue;
    }
    if (a === '--lan') { host = '0.0.0.0'; continue; }
    if (a === '--host') {
      const raw = argv[++i];
      if (!isValidHost(raw)) throw new Error('invalid --host');
      host = raw;
      continue;
    }
    if (a === '--no-attach') { attach = false; continue; }
    if (a === '--attach') { attach = true; continue; }
    if (a === '--detach') { detach = true; continue; }
    if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
    positional.push(a);
  }
  if (positional.length > 1) throw new Error('too many arguments');
  if (positional.length === 1) dir = path.resolve(positional[0]);
  return { dir, port, host, attach, detach };
}

/** 第一个 IPv4 局域网地址；取不到（无网络接口 / 沙箱受限）返回 null。供启动日志打印手机访问地址。 */
export function lanIPv4(): string | null {
  let interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  try {
    interfaces = os.networkInterfaces();
  } catch {
    return null; // 受限环境（如无权限枚举接口）直接放弃，启动日志绝不能被此带崩
  }
  for (const infos of Object.values(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

/** 探测占用端口的服务是不是 anther；host 刚启动时短暂重试。 */
async function probeIdentity(port: number): Promise<AppIdentity | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/anther`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        const body = (await res.json()) as AppIdentity;
        if (body?.name === 'anther') return body;
        return null;
      }
    } catch { /* 重试 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function mountPath(mount: MountWire): string {
  if (mount.legacyRoot) return '/';
  return `${mount.shorthand ?? mount.base}/`;
}

function printMount(port: number, mount: MountWire, label: string, host: string): void {
  const pathname = mountPath(mount);
  console.log(`${label}: http://localhost:${port}${pathname}`);
  if (mount.legacyRoot) {
    const alias = `${mount.shorthand ?? mount.base}/`;
    console.log(`Mount alias: http://localhost:${port}${alias}`);
    console.log(`Canonical: http://localhost:${port}${mount.base}/`);
  } else {
    const canonical = `http://localhost:${port}${mount.base}/`;
    if (canonical !== `http://localhost:${port}${pathname}`) console.log(`Canonical: ${canonical}`);
  }
  const lan = lanIPv4();
  if (lan && (isWildcardHost(host) || host === lan)) {
    console.log(`LAN access: http://${lan}:${port}${pathname}`);
  }
}

/** 端口被占用：确认是 anther、可附加后，走主端口的 loopback-only POST；同目录复用不新建。 */
async function handlePortConflict(args: CliArgs, dir: string): Promise<number> {
  if (!args.attach) {
    console.error(`Port ${args.port} is already in use (--no-attach: will not attach).`);
    return 1;
  }

  const identity = await probeIdentity(args.port);
  if (!identity) {
    console.error(`Port ${args.port} is already in use by another process (not anther).`);
    return 1;
  }
  if (!identity.attach) {
    console.error(`Port ${args.port} is in use by anther, but this instance does not expose attach.`);
    return 1;
  }

  const workspace = await canonicalDir(dir);
  const existing = identity.mounts?.find((mount) => isSameWorkspace(mount.workspace, workspace));
  if (existing) {
    console.log('Already served by an existing anther instance; not creating another mount.');
    printMount(args.port, existing, 'Existing URL', args.host);
    return 0;
  }
  if (!identity.attach.available) {
    console.error(`Port ${args.port} is in use by anther, but attaching is disabled.`);
    return 1;
  }

  let response: { existing?: boolean; mount?: MountWire; error?: string };
  try {
    const res = await fetch(`http://127.0.0.1:${args.port}${ATTACH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
      signal: AbortSignal.timeout(2000),
    });
    response = (await res.json().catch(() => ({}))) as typeof response;
    if (!res.ok) {
      console.error(`Cannot attach to anther on port ${args.port}: ${response.error ?? res.statusText}`);
      return 1;
    }
  } catch (e) {
    console.error(
      `Cannot attach to anther on port ${args.port}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
  if (!response.mount) {
    console.error(`Cannot attach to anther on port ${args.port}: invalid attach response`);
    return 1;
  }

  console.log(`Attached to existing anther at http://localhost:${args.port}`);
  console.log(`Workspace: ${workspace}`);
  printMount(args.port, response.mount, 'URL', args.host);
  return 0;
}

/** --detach：只从运行中的宿主卸载当前目录，不启动服务器。未挂载时只提示，不算失败。 */
async function detachFromHost(args: CliArgs, dir: string): Promise<number> {
  const identity = await probeIdentity(args.port);
  if (!identity) {
    console.error(`Port ${args.port} is not served by anther.`);
    return 1;
  }

  const workspace = await canonicalDir(dir);
  const mount = identity.mounts?.find((item) => isSameWorkspace(item.workspace, workspace));
  if (identity.mounts && !mount) {
    console.log(`Not attached: ${workspace}`);
    return 0;
  }

  try {
    const res = await fetch(`http://127.0.0.1:${args.port}${DETACH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
      signal: AbortSignal.timeout(2000),
    });
    const data = (await res.json().catch(() => ({}))) as { detached?: MountWire | null; error?: string };
    if (!res.ok) {
      console.error(`Cannot detach from anther on port ${args.port}: ${data.error ?? res.statusText}`);
      return 1;
    }
    if (!data.detached) {
      console.log(`Not attached: ${workspace}`);
      return 0;
    }
    console.log(`Detached: ${data.detached.name} (${data.detached.workspace})`);
    return 0;
  } catch (e) {
    console.error(
      `Cannot detach from anther on port ${args.port}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const dir = args.dir;
  if (args.detach) {
    process.exitCode = await detachFromHost(args, dir);
    return;
  }

  const http = new HttpServer({ staticDir: staticDirFor(import.meta.url) });
  const attachState: AttachInfo = { available: args.attach };
  const registry = new MountRegistry(http, () => attachState);

  const hostWorkspace = createWorkspace(dir);
  const hostRouter = new Router();
  registerWorkspaceRoutes(hostRouter, hostWorkspace, registry.providers());
  registerIdentifyRoutes(http, dir, registry.providers());
  registerAttachRoute(http, registry, () => attachState.available);
  registerDetachRoute(http, registry);
  registerListenRoute(http, () => http.listenInfo(), (host) => http.rebind(host));
  await registry.addHost(dir, hostWorkspace, hostRouter);

  const shutdown = () => {
    void (async () => {
      try { await http.close(); } catch { /* exit anyway */ }
      process.exit(0);
    })();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await http.listen(args.port, args.host);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    try { await http.close(); } catch { /* attach flow should still continue */ }
    process.exitCode = await handlePortConflict(args, dir);
    return;
  }

  const actualPort = (http.address() as AddressInfo).port;
  console.log(`anther started: http://localhost:${actualPort}`);
  const scope = isWildcardHost(args.host)
    ? ' (all interfaces)'
    : isLoopbackHost(args.host) ? ' (local only)' : '';
  console.log(`Listen: ${args.host}:${actualPort}${scope}`);
  const lan = lanIPv4();
  if (lan && (isWildcardHost(args.host) || args.host === lan)) {
    console.log(`LAN access: http://${lan}:${actualPort}`);
  }
  console.log(`Root directory: ${dir}`);
  const hostMount = registry.listWire().find((mount) => mount.legacyRoot);
  if (hostMount) printMount(actualPort, hostMount, 'Mount', args.host);
  console.log(`Attach: ${attachState.available ? 'enabled' : 'disabled'}`);
}

// 直接运行时（node server/cli.ts）启动服务器；被 import（如测试）时不执行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
