import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [solid()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/web'),
    emptyOutDir: true,
  },
});
