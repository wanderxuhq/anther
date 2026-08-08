// web/src/url-state.ts
export type UrlState = {
  path: string | null;
  ro: boolean;
  theme: 'auto' | 'light' | 'dark';
  fs: number;
};

const DEFAULTS: UrlState = { path: null, ro: true, theme: 'auto', fs: 100 };

/** 路径编码：只编码特殊字符，保留 / 可读 */
function encodePath(p: string): string {
  return p.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}
function decodePath(s: string): string {
  return s.split('/').map((seg) => decodeURIComponent(seg)).join('/');
}

export function parseUrl(href: string): UrlState {
  const url = new URL(href);
  // %zz 等畸形编码 decodeURIComponent 抛 URIError：包 try/catch 防整站白屏，
  // 失败时 path 取 null，其余字段正常解析
  let path: string | null;
  try {
    const rawPath = decodeURIComponent(url.pathname);
    path = rawPath === '/' || rawPath === '' ? null : rawPath.slice(1);
  } catch {
    path = null;
  }

  const ro = url.searchParams.get('ro') !== '0'; // 默认只读

  const themeParam = url.searchParams.get('theme');
  const theme: UrlState['theme'] =
    themeParam === 'light' || themeParam === 'dark' ? themeParam : 'auto';

  const fsParam = url.searchParams.get('fs');
  const fsRaw = Number(fsParam);
  const fs = fsParam && Number.isFinite(fsRaw) ? Math.min(130, Math.max(85, fsRaw)) : 100;

  return { path, ro, theme, fs };
}

export function serializeUrl(state: UrlState): string {
  const params = new URLSearchParams();
  if (!state.ro) params.set('ro', '0');
  if (state.theme !== 'auto') params.set('theme', state.theme);
  if (state.fs !== 100) params.set('fs', String(state.fs));
  const qs = params.toString();
  const p = state.path === null ? '' : encodePath(state.path);
  return `/${p}${qs ? `?${qs}` : ''}`;
}

export const DEFAULT_STATE: UrlState = { ...DEFAULTS };
