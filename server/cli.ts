import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HttpServer } from './http.ts';
import { FileStore } from './files.ts';
import { TabStore } from './tab-store.ts';
import { registerFsRoutes } from './routes/fs.ts';
import { registerTabsRoutes } from './routes/tabs.ts';

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

export async function main(argv: string[]): Promise<void> {
  const { dir, port } = parseArgs(argv);
  const files = new FileStore(dir);
  const tabs = new TabStore();

  const http = new HttpServer({ staticDir: staticDirFor(import.meta.url) });
  registerFsRoutes(http, files);
  registerTabsRoutes(http, tabs);

  await http.listen(port, '0.0.0.0');
  console.log(`anther 已启动：http://localhost:${port}`);
  console.log(`根目录：${dir}`);
  console.log('写入：前端切换编辑模式（ro=0）即可写，只读模式（ro=1）拒绝');
}

// 直接运行时（node server/cli.ts）启动服务器；被 import（如测试）时不执行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
