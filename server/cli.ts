import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HttpServer } from './http.ts';
import { FileStore } from './files.ts';
import { TabStore } from './tab-store.ts';
import { registerFsRoutes } from './routes/fs.ts';
import { registerTabsRoutes } from './routes/tabs.ts';
import { TerminalManager } from './terminal.ts';
import { registerTerminalRoutes } from './routes/terminal.ts';
import { Git } from './git.ts';
import { registerGitRoutes } from './routes/git.ts';
import { LspManager } from './lsp-manager.ts';
import { registerLspRoutes } from './routes/lsp.ts';

export type CliArgs = { dir: string; port: number };

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
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      const raw = argv[++i];
      if (!raw || !/^\d+$/.test(raw)) throw new Error('invalid --port');
      port = Number(raw);
      continue;
    }
    if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
    positional.push(a);
  }
  if (positional.length > 1) throw new Error('too many arguments');
  if (positional.length === 1) dir = path.resolve(positional[0]);
  return { dir, port };
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

export async function main(argv: string[]): Promise<void> {
  const { dir, port } = parseArgs(argv);
  const files = new FileStore(dir);
  const tabs = new TabStore();

  const http = new HttpServer({ staticDir: staticDirFor(import.meta.url) });
  const terminals = new TerminalManager(dir);
  const git = new Git(dir);
  registerFsRoutes(http, files);
  registerTabsRoutes(http, tabs);
  registerTerminalRoutes(http, terminals);
  registerGitRoutes(http, git);
  const lsp = new LspManager({ workspaceRoot: dir });
  registerLspRoutes(http, lsp);

  const shutdown = () => {
    void Promise.all([lsp.dispose(), http.close()]).finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await http.listen(port, '0.0.0.0');
  console.log(`anther started: http://localhost:${port}`);
  const lan = lanIPv4();
  if (lan) console.log(`LAN access: http://${lan}:${port}`);
  console.log(`Root directory: ${dir}`);
}

// 直接运行时（node server/cli.ts）启动服务器；被 import（如测试）时不执行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
