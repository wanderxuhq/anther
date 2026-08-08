import path from 'node:path';
import { HttpServer } from './http.ts';
import { FileStore } from './files.ts';
import { WriteGate } from './write-gate.ts';
import { TabStore } from './tab-store.ts';
import { registerFsRoutes } from './routes/fs.ts';
import { registerTabsRoutes } from './routes/tabs.ts';

export type CliArgs = { dir: string; port: number; allowWrites: boolean };

export function parseArgs(argv: string[]): CliArgs {
  let dir = process.cwd();
  let port = 3000;
  let allowWrites = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rw') { allowWrites = true; continue; }
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
  return { dir, port, allowWrites };
}

export async function main(argv: string[]): Promise<void> {
  const { dir, port, allowWrites } = parseArgs(argv);
  const files = new FileStore(dir);
  const gate = new WriteGate(allowWrites);
  const tabs = new TabStore();

  const http = new HttpServer({ staticDir: path.resolve(import.meta.dirname, '../dist/web') });
  registerFsRoutes(http, files, gate);
  registerTabsRoutes(http, tabs);

  await http.listen(port, '0.0.0.0');
  console.log(`anther 已启动：http://localhost:${port}`);
  console.log(`根目录：${dir}`);
  console.log(allowWrites ? '模式：可读写' : '模式：只读（以 --rw 启动以允许写入）');
}

// 直接运行时（node server/cli.ts）启动服务器；被 import（如测试）时不执行
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
