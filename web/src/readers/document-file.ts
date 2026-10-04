import { isMarkdownFile } from '../markdown.ts';
import { api, type FileInfo } from '../api.ts';

export const hasDocumentOutline = (path: string) => /\.(pdf|epub)$/i.test(path) || isMarkdownFile(path);
/** Same revision URL for tree metadata and the reader, allowing one shared parser. */
export const documentPreviewUrl = (path: string, info: Pick<FileInfo, 'modified' | 'size'>) =>
  `${api.previewUrl(path)}&v=${encodeURIComponent(`${info.modified}-${info.size}`)}`;

export const documentOutlineSource = async (path: string) => /\.epub$/i.test(path)
  ? (await import('./epub-source.ts')).acquireEpubSource
  : (await import('./pdf-source.ts')).acquirePdfSource;
