import { isMarkdownFile } from '../markdown.ts';
import { api, type FileInfo } from '../api.ts';

export const hasDocumentOutline = (path: string) => /\.pdf$/i.test(path) || isMarkdownFile(path);
/** Same revision URL for tree metadata and the reader, allowing one shared parser. */
export const documentPreviewUrl = (path: string, info: Pick<FileInfo, 'modified' | 'size'>) =>
  `${api.previewUrl(path)}&v=${encodeURIComponent(`${info.modified}-${info.size}`)}`;
