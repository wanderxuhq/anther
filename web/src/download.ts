import { createSignal } from 'solid-js';
import { api } from './api.ts';

export const [preparingDownload, setPreparingDownload] = createSignal(false);
let beforeDownload: ((path: string, directory: boolean) => Promise<void>) | undefined;
export function setBeforeDownload(handler?: typeof beforeDownload) { beforeDownload = handler; }

/** 工作区文件直接接收下载流；虚拟文件以已有的 Blob URL 复用同一下载入口。 */
export async function startDownload(source: string | { url: string; filename: string }, directory = false): Promise<void> {
  if (preparingDownload()) return;
  setPreparingDownload(true);
  try {
    if (typeof source === 'string') await beforeDownload?.(source, directory);
    let url = typeof source === 'string' ? api.downloadUrl(source) : source.url;
    let filename = typeof source === 'string' ? source.split('/').pop() ?? source : source.filename;
    if (directory && typeof source === 'string') {
      let result = await api.prepareDownload(source);
      while (result.kind === 'archive' && result.status === 'preparing') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result = await api.downloadStatus(result.id);
      }
      if (result.kind === 'archive' && result.status === 'failed') throw new Error(result.error);
      if (!result.url) throw new Error('Download is no longer available');
      url = result.url;
      filename = result.filename;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally { setPreparingDownload(false); }
}
