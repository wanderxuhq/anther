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
  const rawPath = decodeURIComponent(url.pathname);
  const path = rawPath === '/' || rawPath === '' ? null : rawPath.slice(1);

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
