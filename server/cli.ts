// server/cli.ts
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { HttpServer } from './http.ts';
import { createWorkspace, registerWorkspaceRoutes } from './workspace.ts';
import { MountRegistry, canonicalDir, isSameWorkspace } from './mounts.ts';
import { ATTACH_PATH, registerAttachRoute } from './routes/attach.ts';
import type { AppIdentity } from './app-info.ts';
import type { AttachInfo, MountWire } from './mount-types.ts';

export type CliArgs = { dir: string; port: number; attach: boolean };

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
  let attach = true;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      const raw = argv[++i];
      if (!raw || !/^\d+$/.test(raw)) throw new Error('invalid --port');
      port = Number(raw);
      continue;
    }
    if (a === '--no-attach') { attach = false; continue; }
    if (a === '--attach') { attach = true; continue; }
    if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
    positional.push(a);
  }
  if (positional.length > 1) throw new Error('too many arguments');
  if (positional.length === 1) dir = path.resolve(positional[0]);
  return { dir, port, attach };
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

function printMount(port: number, mount: MountWire, label: string): void {
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
  if (lan) console.log(`LAN access: http://${lan}:${port}${pathname}`);
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
    printMount(args.port, existing, 'Existing URL');
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
  printMount(args.port, response.mount, 'URL');
  return 0;
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const dir = args.dir;

  const http = new HttpServer({ staticDir: staticDirFor(import.meta.url) });
  const attachState: AttachInfo = { available: args.attach };
  const registry = new MountRegistry(http, () => attachState);

  const hostWorkspace = createWorkspace(dir);
  registerWorkspaceRoutes(http, hostWorkspace, registry.providers());
  registerAttachRoute(http, registry, () => attachState.available);
  await registry.addHost(dir, hostWorkspace);

  const shutdown = () => {
    void (async () => {
      try { await http.close(); } catch { /* exit anyway */ }
      process.exit(0);
    })();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await http.listen(args.port, '0.0.0.0');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    try { await http.close(); } catch { /* attach flow should still continue */ }
    process.exitCode = await handlePortConflict(args, dir);
    return;
  }

  const actualPort = (http.address() as AddressInfo).port;
  console.log(`anther started: http://localhost:${actualPort}`);
  const lan = lanIPv4();
  if (lan) console.log(`LAN access: http://${lan}:${actualPort}`);
  console.log(`Root directory: ${dir}`);
  const hostMount = registry.listWire().find((mount) => mount.legacyRoot);
  if (hostMount) printMount(actualPort, hostMount, 'Mount');
  console.log(`Attach: ${attachState.available ? 'enabled' : 'disabled'}`);
}

// 直接运行时（node server/cli.ts）启动服务器；被 import（如测试）时不执行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
