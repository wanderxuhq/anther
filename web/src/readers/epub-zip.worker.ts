import { ZipReader, HttpRangeReader, BlobReader, Uint8ArrayWriter, configure, type Entry } from '@zip.js/zip.js';
import wasmUrl from '@zip.js/zip.js/dist/zip-module.wasm?url';
import { archivePath } from '../archive.ts';

configure({ useWebWorkers: false, wasmURI: new URL(wasmUrl, location.href).href });
let zip: ZipReader<HttpRangeReader | BlobReader> | undefined;
let entries = new Map<string, Entry>();
const channel = globalThis as unknown as { onmessage(event: MessageEvent): void; postMessage(value: unknown, transfer?: Transferable[]): void };
channel.onmessage = async ({ data: { id, url, path, limit } }) => {
  try {
    if (url) {
      const input = url.startsWith('blob:') ? new BlobReader(await (await fetch(url)).blob()) : new HttpRangeReader(url, { checkResourceChanges: true });
      zip = new ZipReader(input, { useWebWorkers: false });
      entries = new Map();
      let count = 0;
      for await (const entry of zip.getEntriesGenerator()) {
        if (++count > 20_000) throw new Error('Too many EPUB entries');
        const name = archivePath(entry.filename);
        if (!name || entries.has(name)) throw new Error('Invalid EPUB entry');
        if (!entry.directory) entries.set(name, entry);
      }
      channel.postMessage({ id, paths: [...entries.keys()] });
    } else {
      const entry = entries.get(path);
      if (!entry || entry.directory || !entry.getData || entry.encrypted) throw new Error('EPUB entry unavailable');
      if (entry.uncompressedSize > limit) throw new Error('EPUB entry too large');
      const bytes = await entry.getData(new Uint8ArrayWriter(), { checkSignature: true, onprogress: (size) => { if (size > limit) throw new Error('EPUB entry too large'); } });
      channel.postMessage({ id, bytes }, [bytes.buffer]);
    }
  } catch (error) { channel.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
