#!/usr/bin/env node
// 一键开发模式：后端（node --watch）+ 前端（vite）同终端启动。
// 零依赖实现（无 concurrently 等）：spawn 两个子进程，共享终端输出。
// 每个子进程独立进程组（detached），SIGINT/SIGTERM/SIGHUP 或任一子进程崩溃时
// 按进程组整组清理（kill(-pid) 覆盖组内全部，含 node --watch 派生的后端进程）。
// 透传参数给后端（如 npm run dev -- --port 8080）。
import { spawn } from 'node:child_process';

const backendArgs = process.argv.slice(2);
// 开发模式由 Vite 提供前端，不保证挂载 base；显式关闭附加，避免第二个 dev 实例
// 的后端挂上去了但前端 5173 仍然冲突。生产 CLI 默认开启。
if (!backendArgs.includes('--no-attach')) backendArgs.push('--no-attach');
const frontendArgs = ['node_modules/vite/bin/vite.js', '--config', 'web/vite.config.ts'];

// 前端默认也只听本机；--lan / --host 与后端保持一致（按参数出现顺序，后者覆盖前者）。
let viteHost = null;
for (let i = 0; i < backendArgs.length; i++) {
  if (backendArgs[i] === '--lan') viteHost = '0.0.0.0';
  else if (backendArgs[i] === '--host') {
    const value = backendArgs[i + 1];
    if (value && !value.startsWith('-')) viteHost = value;
    i++;
  }
}
if (viteHost) frontendArgs.push('--host', viteHost);

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM'); // 整组清理
    } catch { /* 已退出 */ }
  }
  setTimeout(() => process.exit(code), 500); // 给子进程收尾时间
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));

function start(label, args) {
  const c = spawn(process.execPath, args, { stdio: 'inherit', detached: true });
  c.on('exit', (code) => {
    // 任一进程非正常退出（崩溃/被 kill）→ 联动关掉另一个并带错误码退出
    if (!shuttingDown && code !== 0) {
      console.error(`[dev] ${label} 退出（code ${code}），联动关闭另一进程`);
      shutdown(code ?? 1);
    }
  });
  children.push(c);
  return c;
}

start('backend', ['--watch', '--experimental-transform-types', 'server/cli.ts', ...backendArgs]);
start('frontend', frontendArgs);
