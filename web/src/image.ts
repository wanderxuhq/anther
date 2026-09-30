import { api } from './api.ts';

export function isImageFile(path: string | null): boolean {
  return path !== null && /\.(png|apng|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(path);
}

export function isBinaryImage(path: string | null): boolean {
  return isImageFile(path) && !/\.svg$/i.test(path!);
}

/** Markdown 的本地图片相对文档所在目录解析；外链、data URI 和片段保持原样。 */
export function resolveImageSource(source: string, documentPath: string, version?: string): string {
  if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) return source;
  const base = `https://workspace.invalid/${documentPath.split('/').map(encodeURIComponent).join('/')}`;
  try {
    const url = new URL(source, base);
    return api.imageUrl(decodeURIComponent(url.pathname.slice(1))) + (version ? `&v=${encodeURIComponent(version)}` : '') + url.hash;
  } catch { return source; }
}
