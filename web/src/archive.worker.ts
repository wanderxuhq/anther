import type { SevenZipModule, SevenZipModuleFactory, FSNode } from '7z-wasm';
import type { Entry, ZipReader, HttpRangeReader, BlobReader } from '@zip.js/zip.js';
import { archivePath, DEFAULT_ARCHIVE_LIMITS, isZipFile, parseSevenZipListing, type ArchiveEntry, type ArchiveRequest, type ArchiveReply } from './archive.ts';
import sevenModuleUrl from '7z-wasm/7zz.es6.js?url';
import sevenWasmUrl from '7z-wasm/7zz.wasm?url';
import zipWasmUrl from '@zip.js/zip.js/dist/zip-module.wasm?url';

const channel = globalThis as unknown as { onmessage: (event: MessageEvent<ArchiveRequest>) => void; postMessage: (reply: ArchiveReply) => void };
let zip: ZipReader<HttpRangeReader | BlobReader> | undefined;
let zipEntries: Entry[] = [];
let entries: ArchiveEntry[] = [];
let seven: SevenZipModule | undefined;
let sevenLog: string[] = [];
let archiveName = '', rootUrl = '', rootEtag = '';
let activeChain: string[] = [];
let limits = DEFAULT_ARCHIVE_LIMITS, heldBytes = 0;
let limitFailure: 'depth' | 'budget' | undefined;
const nested = new Map<string, { chain: string[]; blob: Blob }>();
const cachedBytes = () => [...nested.values()].reduce((sum, item) => sum + item.blob.size, 0);
const prefixOf = (prefix: string[], chain: string[]) => prefix.every((name, index) => chain[index] === name);
function budgetError() { limitFailure = 'budget'; return Object.assign(new Error('Archive buffer budget exceeded'), { limit: 'budget' }); }
function discardUnused() {
  // Current inputs stay pinned. Other branches can be reconstructed on demand.
  for (const [key, value] of nested) if (!prefixOf(value.chain, activeChain)) nested.delete(key);
}
function outputBudget() { discardUnused(); return Math.max(0, limits.maxBufferedBytes - heldBytes - cachedBytes()); }
let requestId = 0, lastProgress = 0;
function progress(value: number) {
  if (performance.now() - lastProgress < 100) return;
  lastProgress = performance.now();
  channel.postMessage({ id: requestId, progress: value });
}

async function mountRangeFile(module: SevenZipModule, url: string, name: string) {
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`HTTP ${head.status}`);
  const size = Number(head.headers.get('content-length')), etag = head.headers.get('etag');
  if (etag !== rootEtag) throw new Error('Archive changed while being read');
  if (!Number.isSafeInteger(size) || size < 0 || !etag || head.headers.get('accept-ranges') !== 'bytes') throw new Error('Range reads unavailable');
  const chunks = new Map<number, Uint8Array>();
  const chunkSize = 1024 * 1024;
  const getChunk = (index: number) => {
    let chunk = chunks.get(index);
    if (chunk) { chunks.delete(index); chunks.set(index, chunk); return chunk; }
    // Synchronous reads are confined to this worker, because the WASM filesystem is synchronous.
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false); xhr.responseType = 'arraybuffer';
    const start = index * chunkSize, end = Math.min(size - 1, start + chunkSize - 1);
    xhr.setRequestHeader('Range', `bytes=${start}-${end}`); xhr.setRequestHeader('If-Match', etag);
    xhr.send();
    if (xhr.status !== 206 || xhr.getResponseHeader('etag') !== etag) throw new Error('Archive changed or could not be read');
    chunk = new Uint8Array(xhr.response);
    if (chunk.byteLength !== end - start + 1) throw new Error('Incomplete archive data');
    chunks.set(index, chunk);
    if (chunks.size > 8) chunks.delete(chunks.keys().next().value!);
    return chunk;
  };
  const node = module.FS.createLazyFile('/input', name, url, true, false);
  // Replace Emscripten's unbounded lazy cache with an 8 MiB LRU and ETag-guarded reads.
  const contents = { length: size, get: (index: number) => getChunk(Math.floor(index / chunkSize))[index % chunkSize] };
  node.contents = contents as unknown as typeof node.contents;
  const streamNode = node as unknown as { stream_ops: { read: (stream: unknown, target: Uint8Array, offset: number, length: number, position: number) => number } };
  streamNode.stream_ops.read = (_stream, target, offset, length, position) => {
    const count = Math.max(0, Math.min(length, size - position));
    for (let read = 0; read < count;) {
      const index = position + read, chunk = getChunk(Math.floor(index / chunkSize)), inChunk = index % chunkSize;
      const take = Math.min(count - read, chunk.length - inChunk);
      target.set(chunk.subarray(inChunk, inChunk + take), offset + read); read += take;
    }
    return count;
  };
}

async function openSource(source: string | Blob, path: string, password?: string): Promise<ArchiveEntry[]> {
  await zip?.close(); zip = undefined; zipEntries = []; seven = undefined; entries = [];
  if (isZipFile(path)) {
    const lib = await import('@zip.js/zip.js');
    lib.configure({ useWebWorkers: false, wasmURI: new URL(zipWasmUrl, location.href).href });
    const reader = typeof source === 'string' ? new lib.HttpRangeReader(source, { checkResourceChanges: true, headers: new Map([['If-Match', rootEtag]]) }) : new lib.BlobReader(source);
    zip = new lib.ZipReader(reader, { useWebWorkers: false });
    zipEntries = await zip.getEntries();
    entries = zipEntries.map((entry, id) => {
      const path = archivePath(entry.filename);
      if (!path) throw new Error('Unsupported archive filename');
      return { id, path, directory: entry.directory, size: entry.uncompressedSize, encrypted: entry.encrypted,
        link: ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000 };
    });
  } else {
      const { default: factory } = await import(/* @vite-ignore */ sevenModuleUrl) as { default: SevenZipModuleFactory };
      seven = await factory({ locateFile: () => new URL(sevenWasmUrl, location.href).href,
        print: (line) => { sevenLog.push(line); const match = /(?:^|\s)(\d+)%/.exec(line); if (match) progress(Number(match[1])); }, printErr: (line) => sevenLog.push(line), stdin: () => null as unknown as number,
        noExitRuntime: true, ...{ noInitialRun: true } });
      seven.FS.mkdir('/input'); seven.FS.mkdir('/output');
      archiveName = `/input/${path.split('/').pop()!}`;
      if (typeof source === 'string') await mountRangeFile(seven, source, path.split('/').pop()!);
      else seven.FS.mount(seven.WORKERFS, { blobs: [{ name: path.split('/').pop()!, data: source }] }, '/input');
    runSeven(['l', '-slt', '-sccUTF-8', `-p${password ?? ''}`, '--', archiveName]);
    entries = parseSevenZipListing(sevenLog.join('\n'));
  }
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) throw new Error('Duplicate archive filenames');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

async function open(url: string, path: string, chain: string[], passwords: (string | undefined)[]) {
  if (chain.length + 1 > limits.maxDepth) { limitFailure = 'depth'; throw new Error('Archive nesting depth exceeded'); }
  if (chain.some((name) => archivePath(name) !== name)) throw new Error('Unsupported nested archive path');
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`HTTP ${head.status}`);
  const etag = head.headers.get('etag') ?? '';
  if (url !== rootUrl || etag !== rootEtag) nested.clear();
  rootUrl = url; rootEtag = etag;
  activeChain = chain;
  discardUnused();
  if (cachedBytes() + heldBytes > limits.maxBufferedBytes) throw budgetError();
  // Begin at the deepest retained input, then materialize only the requested path.
  let depth = chain.length;
  while (depth > 0 && !nested.has(JSON.stringify(chain.slice(0, depth)))) depth--;
  activeChain = chain.slice(0, depth);
  const source = depth ? nested.get(JSON.stringify(activeChain))!.blob : url;
  await openSource(source, depth ? chain[depth - 1] : path, passwords[depth]);
  while (depth < chain.length) {
    const entry = entries.find((entry) => entry.path === chain[depth]);
    if (!entry) throw new Error('Nested archive no longer exists');
    const blob = await extract(entry.id, passwords[depth]);
    depth++; activeChain = chain.slice(0, depth);
    nested.set(JSON.stringify(activeChain), { chain: activeChain, blob });
    await openSource(blob, chain[depth - 1], passwords[depth]);
  }
  return entries;
}

function runSeven(args: string[]) {
  sevenLog = [];
  const code = seven!.callMain(args) as unknown as number;
  if (code !== 0) {
    const log = sevenLog.join('\n');
    throw Object.assign(new Error('Unable to read this archive'), { passwordRequired: /password|encrypted/i.test(log) });
  }
}

function clearOutput() {
  const fs = seven!.FS;
  const remove = (dir: string) => {
    for (const name of fs.readdir(dir).filter((name) => name !== '.' && name !== '..')) {
      const child = `${dir}/${name}`;
      if (fs.isDir(fs.lstat(child).mode)) { remove(child); fs.rmdir(child); } else fs.unlink(child);
    }
  };
  remove('/output');
}

async function extract(id: number, password?: string): Promise<Blob> {
  const entry = entries.find((entry) => entry.id === id);
  if (!entry || entry.directory || entry.link) throw new Error('Unsupported archive entry');
  const available = outputBudget();
  if (entry.size > available) throw budgetError();
  if (entry.encrypted && !password) throw Object.assign(new Error('Password required'), { passwordRequired: true });
  if (zip) {
    const lib = await import('@zip.js/zip.js');
    const file = zipEntries[id];
    if (file.directory) throw new Error('Not a file');
    try {
      let written = 0;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      // Check actual output too: archive headers are not an allocation guarantee.
      await file.getData(new WritableStream<Uint8Array>({ write(chunk) {
        if (written + chunk.byteLength > available) throw budgetError();
        written += chunk.byteLength; chunks.push(new Uint8Array(chunk));
      } }), { password, checkSignature: true, useWebWorkers: false, onprogress: (done, total) => progress(total ? Math.round(done / total * 100) : 0) });
      return new Blob(chunks);
    }
    catch (error) {
      const message = (error as Error).message;
      if ([lib.ERR_ENCRYPTED, lib.ERR_INVALID_PASSWORD].includes(message)) Object.assign(error as Error, { passwordRequired: true });
      throw error;
    }
  }
  const fs = seven!.FS, write = fs.write;
  let written = 0;
  const outputSizes = new Map<string, number>();
  fs.write = (...args: Parameters<typeof write>) => {
    const [stream, , , length, position] = args;
    const target = stream as unknown as { node: FSNode; position: number };
    const name = fs.getPath(target.node);
    if (name.startsWith('/output/')) {
      const before = outputSizes.get(name) ?? 0, after = Math.max(before, (position ?? target.position) + length);
      if (written + after - before > available) throw budgetError();
      written += after - before; outputSizes.set(name, after);
    }
    return write(...args);
  };
  try {
    // Exact names, no wildcard expansion, no link following into any other filesystem.
    runSeven(['x', '-y', '-spd', '-ssc', '-bsp1', '-sccUTF-8', '-o/output', `-p${password ?? ''}`, '--', archiveName, entry.sourcePath ?? entry.path]);
    const path = `/output/${entry.path}`;
    if (!fs.isFile(fs.lstat(path).mode)) throw new Error('Unsupported archive entry');
    const data = fs.readFile(path);
    return new Blob([new Uint8Array(data)]);
  } finally { fs.write = write; clearOutput(); }
}

channel.onmessage = async ({ data }) => {
  requestId = data.id; lastProgress = 0;
  limits = data.limits ?? DEFAULT_ARCHIVE_LIMITS; heldBytes = Math.max(0, data.heldBytes ?? 0); limitFailure = undefined;
  try {
    if (data.action === 'open') channel.postMessage({ id: data.id, entries: await open(data.url!, data.path!, data.chain ?? [], data.passwords ?? [data.password]) });
    else channel.postMessage({ id: data.id, blob: await extract(data.entry!, data.password) });
  } catch (error) {
    channel.postMessage({ id: data.id, error: (error as Error).message || 'Unable to read this archive', passwordRequired: !!(error as { passwordRequired?: boolean }).passwordRequired, passwordDepth: activeChain.length, limit: limitFailure });
  }
};
