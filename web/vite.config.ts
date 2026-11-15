import { defineConfig, type Plugin } from 'vite';
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

// Vite 以 web/ 为 root：工作区里的 tsconfig.json、src/... 等路径在浏览器刷新时
// 会命中 web/ 下的真实文件，直接返回静态内容而不启动 SPA。导航请求统一交给
// index.html，让 URL 恢复（包括 #line:）始终走前端路由；API/功能 bundle 仍走代理。
function spaNavigationFallback(): Plugin {
  const proxiedFeature = /^\/_\/[^/]+\/(?:ui\.js|api(?:\/|$))/;
  return {
    name: 'anther:spa-navigation-fallback',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const pathname = (req.url ?? '/').split('?')[0];
        const accept = req.headers.accept ?? '';
        const mode = req.headers['sec-fetch-mode'];
        if (!String(accept).includes('text/html') || (mode && mode !== 'navigate')) return next();
        if (pathname.startsWith('/@') || pathname === '/api' || pathname.startsWith('/api/')
          || proxiedFeature.test(pathname)) return next();
        req.url = '/index.html';
        next();
      });
    },
  };
}

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [spaNavigationFallback(), solid(), pdfAssets()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'], include: ['@zip.js/zip.js', 'pdfjs-dist', 'pdfjs-dist/web/pdf_viewer.mjs'] },
  server: {
    host: '127.0.0.1', // 默认仅本机；用 --host 0.0.0.0（或 npm run dev -- --lan）开放给局域网
    port: 5173,
    // ws: true 让 Vite 把 WebSocket upgrade（终端、LSP）转发到后端。
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
      // 可选功能面板的运行时 bundle / API 在 /_/<panel>/ui.js 与 /_/<panel>/api/*；
      // 开发时转发给后端，面板页面本身仍由 Vite 提供（保留 HMR）。
      '^/_/[^/]+/(?:ui\\.js|api(?:/|$))': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/web'),
    emptyOutDir: true,
  },
});
