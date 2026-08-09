import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import path from 'node:path';
import os from 'node:os';

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
  plugins: [solid()],
  server: {
    host: true, // 监听所有网卡：手机/其他主机通过 IP 访问（vite 默认只绑 localhost）
    port: 5173,
    // 原：proxy: { '/api': 'http://localhost:3000' }
    // 改为（ws: true 让 vite 转发 WS upgrade 到后端）：
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/web'),
    emptyOutDir: true,
  },
});
