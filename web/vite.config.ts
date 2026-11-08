import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import path from 'node:path';
import os from 'node:os';
import { pdfAssets } from './pdf-assets.ts';

// 受限环境（容器/沙箱）os.networkInterfaces() 抛 EACCES，vite 在 host 为通配符
// （host:true/0.0.0.0）时枚举网卡打印 URL → 启动即崩（uv_interface_addresses err 13）。
// 监听 0.0.0.0 本身不需要网卡信息；只在枚举失败时退回空回环接口，正常环境零影响。
try {
  os.networkInterfaces();
} catch {
  os.networkInterfaces = () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  });
}

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [solid(), pdfAssets()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'], include: ['@zip.js/zip.js', 'pdfjs-dist', 'pdfjs-dist/web/pdf_viewer.mjs'] },
  server: {
    host: '127.0.0.1', // 默认仅本机；用 --host 0.0.0.0（或 npm run dev -- --lan）开放给局域网
    port: 5173,
    // ws: true 让 Vite 把 WebSocket upgrade（终端、LSP）转发到后端。
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/web'),
    emptyOutDir: true,
  },
});
