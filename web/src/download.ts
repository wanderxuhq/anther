import { createSignal } from 'solid-js';
import { api } from './api.ts';

export const [preparingDownload, setPreparingDownload] = createSignal(false);
let beforeDownload: ((path: string, directory: boolean) => Promise<void>) | undefined;
export function setBeforeDownload(handler?: typeof beforeDownload) { beforeDownload = handler; }

/** 浏览器直接接收下载流；这里只轮询归档状态，不把文件读成内存 Blob。 */
export async function startDownload(path: string, directory = false): Promise<void> {
  if (preparingDownload()) return;
  setPreparingDownload(true);
  try {
    await beforeDownload?.(path, directory);
    let url = api.downloadUrl(path);
    let filename = path.split('/').pop() ?? path;
    if (directory) {
      let result = await api.prepareDownload(path);
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
