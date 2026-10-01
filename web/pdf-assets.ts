import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

// PDF.js resolves these files by name; serve the same versioned paths in dev and builds.
export function pdfAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const { version } = require('pdfjs-dist/package.json');
  const prefix = `pdfjs/${version}/`;
  const files = new Map<string, string>();
  async function collect() {
    const sevenRoot = path.dirname(require.resolve('7z-wasm/package.json'));
    for (const name of ['License.txt', 'unRarLicense.txt']) files.set(`licenses/7z-wasm/${name}`, path.join(sevenRoot, name));
    const zipRoot = path.dirname(require.resolve('@zip.js/zip.js/package.json'));
    files.set('licenses/zip.js/LICENSE', path.join(zipRoot, 'LICENSE'));
    files.set(`${prefix}pdf.worker.mjs`, path.join(root, 'build/pdf.worker.mjs'));
    files.set(`${prefix}LICENSE`, path.join(root, 'LICENSE'));
    for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      for (const name of await readdir(path.join(root, dir))) files.set(`${prefix}${dir}/${name}`, path.join(root, dir, name));
    }
    for (const name of await readdir(path.join(root, 'web/images'))) files.set(`${prefix}images/${name}`, path.join(root, 'web/images', name));
  }
  return {
    name: 'pdfjs-local-assets',
    async configureServer(server) {
      await collect();
      server.middlewares.use(async (req, res, next) => {
        const file = files.get((req.url ?? '').split('?')[0].replace(/^\//, ''));
        if (!file) return next();
        try {
          const data = await readFile(file);
          res.setHeader('Content-Type', file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
          res.end(data);
        } catch (error) { next(error); }
      });
    },
    async generateBundle() {
      await collect();
      for (const [fileName, file] of files) this.emitFile({ type: 'asset', fileName, source: await readFile(file) });
    },
  };
}
