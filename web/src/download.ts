import { createSignal } from 'solid-js';
import { api, type ArchiveDownload } from './api.ts';
import { withBase } from './base.ts';
import { t } from './i18n.ts';

export const [preparingDownload, setPreparingDownload] = createSignal(false);
const [archiveProgress, setArchiveProgress] = createSignal<ArchiveDownload | null>(null);
export function downloadProgressText() {
  const status = archiveProgress(), progress = status?.progress;
  if (!status) return t('download.preparing');
  if (status.phase === 'queued') return t('download.queued');
  if (!progress) return t(`download.${status.phase}`);
  if (status.phase === 'scanning') return t('download.scanningProgress', { count: progress.entries });
  if (status.phase === 'verifying') return t('download.verifyingProgress', { done: progress.checkedEntries, total: progress.entries });
  const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  return t('download.packingProgress', { done: mib(progress.readBytes), total: mib(progress.totalBytes), written: mib(progress.writtenBytes) });
}

/** Bound each small control request, not the time needed to compress a large folder. */
async function controlRequest<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(t('download.statusTimeout'))); controller.abort(); }, 30_000);
  });
  try { return await Promise.race([request(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}
let beforeDownload: ((path: string, directory: boolean) => Promise<void>) | undefined;
export function setBeforeDownload(handler?: typeof beforeDownload) { beforeDownload = handler; }

/** 工作区文件直接接收下载流；虚拟文件以已有的 Blob URL 复用同一下载入口。 */
export async function startDownload(source: string | { url: string; filename: string }, directory = false): Promise<void> {
  if (preparingDownload()) return;
  setArchiveProgress(null);
  setPreparingDownload(true);
  try {
    if (typeof source === 'string') await beforeDownload?.(source, directory);
    let url = typeof source === 'string' ? api.downloadUrl(source) : withBase(source.url);
    let filename = typeof source === 'string' ? source.split('/').pop() ?? source : source.filename;
    if (directory && typeof source === 'string') {
      let result = await controlRequest((signal) => api.prepareDownload(source, signal));
      while (result.kind === 'archive' && result.status === 'preparing') {
        setArchiveProgress(result);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const id = result.id;
        result = await controlRequest((signal) => api.downloadStatus(id, signal));
      }
      if (result.kind === 'archive' && result.status === 'failed') throw new Error(result.error);
      if (!result.url) throw new Error('Download is no longer available');
      // 服务端返回的是根相对地址；挂载页需要补上 base。
      url = withBase(result.url);
      filename = result.filename;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally { setPreparingDownload(false); setArchiveProgress(null); }
}
