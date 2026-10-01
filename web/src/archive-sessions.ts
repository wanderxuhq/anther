import { createStore } from 'solid-js/store';
import { api } from './api.ts';
import { ArchiveClient } from './archive-client.ts';
import { archiveKey, type ArchiveEntry } from './archive.ts';
import { archiveLimits } from './archive-settings.ts';
import { startDownload } from './download.ts';

type Session = { entries?: ArchiveEntry[]; busy?: 'queued' | 'scanning' | 'extracting'; progress?: number; error?: string; passwordRequired?: boolean; passwordDepth?: number; limit?: 'depth' | 'budget' };
export const [archiveSessions, setArchiveSession] = createStore<Record<string, Session>>({});
export const archiveSession = (root: string, chain: string[] = []) => archiveSessions[archiveKey(root, chain)];
let client: ArchiveClient | undefined, clientRoot = '', loadedKey = '', activeKey = '';
let queue = Promise.resolve(), heldBytes = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const generations = new Map<string, number>(), passwords = new Map<string, string>();
export type ArchiveBlob = { blob: Blob; release: () => void };
function retain(blob: Blob): ArchiveBlob {
  heldBytes += blob.size;
  let released = false;
  return { blob, release: () => { if (!released) { released = true; heldBytes -= blob.size; } } };
}
function releaseWorker() { client?.close(); client = undefined; clientRoot = ''; loadedKey = ''; }
export function cancelArchive(root: string, forgetPasswords = false) {
  for (const key of Object.keys(archiveSessions)) if (JSON.parse(key)[0] === root) {
    generations.set(key, (generations.get(key) ?? 0) + 1);
    setArchiveSession(key, { busy: undefined, progress: undefined, passwordRequired: false, error: undefined, limit: undefined });
  }
  if (clientRoot === root) releaseWorker();
  if (forgetPasswords) for (const key of passwords.keys()) if (JSON.parse(key)[0] === root) passwords.delete(key);
}
export const archiveBusy = (root: string) => Object.entries(archiveSessions).some(([key, value]) => JSON.parse(key)[0] === root && !!value.busy);
export function closeArchives() {
  clearTimeout(idleTimer);
  for (const root of new Set(Object.keys(archiveSessions).map((key) => JSON.parse(key)[0] as string))) cancelArchive(root, true);
  releaseWorker();
}
function checkDepth(root: string, chain: string[]) {
  if (chain.length + 1 <= archiveLimits().maxDepth) return;
  const error = Object.assign(new Error('Archive nesting depth exceeded'), { limit: 'depth' as const });
  setArchiveSession(archiveKey(root, chain), { error: error.message, limit: error.limit, busy: undefined });
  throw error;
}
async function run<T>(root: string, chain: string[], stage: 'scanning' | 'extracting', action: (client: ArchiveClient) => Promise<T>, password?: string): Promise<T> {
  checkDepth(root, chain);
  const key = archiveKey(root, chain), generation = generations.get(key) ?? 0;
  if (password !== undefined) {
    const depth = archiveSessions[key]?.passwordDepth ?? chain.length;
    passwords.set(archiveKey(root, chain.slice(0, depth)), password);
  }
  setArchiveSession(key, { busy: 'queued', error: undefined, passwordRequired: false, passwordDepth: undefined, limit: undefined, progress: undefined });
  const result = queue.then(async () => {
    if ((generations.get(key) ?? 0) !== generation) throw new Error('Cancelled');
    checkDepth(root, chain);
    clearTimeout(idleTimer);
    if (!client || clientRoot !== root) {
      releaseWorker(); clientRoot = root;
      client = new ArchiveClient((progress) => setArchiveSession(activeKey, { progress }));
    }
    activeKey = key;
    setArchiveSession(key, { busy: loadedKey === key ? stage : 'scanning' });
    if (loadedKey !== key) {
      const reply = await client.request({ action: 'open', url: new URL(api.downloadUrl(root), location.href).href, path: root, chain,
        passwords: Array.from({ length: chain.length + 1 }, (_, depth) => passwords.get(archiveKey(root, chain.slice(0, depth)))), limits: archiveLimits(), heldBytes });
      setArchiveSession(key, { entries: reply.entries }); loadedKey = key;
    }
    setArchiveSession(key, { busy: stage });
    return action(client);
  });
  queue = result.then(() => {}, () => {});
  try { return await result; }
  catch (error) {
    if ((generations.get(key) ?? 0) === generation) {
      const details = error as Error & { passwordRequired?: boolean; passwordDepth?: number; limit?: 'depth' | 'budget' };
      setArchiveSession(key, { error: details.message, passwordRequired: !!details.passwordRequired, passwordDepth: details.passwordDepth, limit: details.limit });
      if (clientRoot === root) releaseWorker();
    }
    throw error;
  } finally {
    if ((generations.get(key) ?? 0) === generation) setArchiveSession(key, { busy: undefined, progress: undefined });
    idleTimer = setTimeout(() => { if (!Object.values(archiveSessions).some((session) => session.busy)) releaseWorker(); }, 60_000);
  }
}
export async function ensureArchive(root: string, password?: string, refresh = false, chain: string[] = []): Promise<void> {
  checkDepth(root, chain);
  if (!refresh && archiveSession(root, chain)?.entries && password === undefined) return;
  if (archiveSession(root, chain)?.busy) return;
  if (refresh && clientRoot === root) releaseWorker();
  await run(root, chain, 'scanning', async () => {}, password);
}
export async function extractArchive(root: string, name: string, password?: string, chain: string[] = []): Promise<ArchiveBlob> {
  return run(root, chain, 'extracting', async (client) => {
    const entry = archiveSession(root, chain)?.entries?.find((entry) => entry.path === name && !entry.directory);
    if (!entry) throw new Error('File no longer exists in this archive');
    const reply = await client.request({ action: 'extract', entry: entry.id, password: passwords.get(archiveKey(root, chain)), limits: archiveLimits(), heldBytes });
    return retain(reply.blob!);
  }, password);
}
export async function downloadArchiveEntry(root: string, name: string, chain: string[] = []): Promise<void> {
  const value = await extractArchive(root, name, undefined, chain);
  try {
    const url = URL.createObjectURL(value.blob);
    await startDownload({ url, filename: name.split('/').pop()! });
    setTimeout(() => { URL.revokeObjectURL(url); value.release(); }, 60_000);
  } catch (error) { value.release(); throw error; }
}
