export type MainView = 'file' | 'git' | 'diff' | 'history' | 'branches' | 'commit';
export type Panel = 'files' | 'tabs' | 'search';
/** URL 使用从 1 开始的行号，end 包含在选区内。 */
export type LineRange = { start: number; end: number };
export const DEFAULT_EXCLUDE = '.git,node_modules,dist';

export type UrlState = {
  path: string | null;
  term: string | null;
  ro: boolean;
  theme: 'auto' | 'light' | 'dark';
  fs: number;
  view: MainView;
  line: LineRange | null;
  branch: string | null;
  commit: string | null;
  panel: Panel;
  query: string;
  caseSensitive: boolean;
  exclude: string;
  lang: 'en' | 'zh' | null;
};

export const DEFAULT_STATE: UrlState = {
  path: null, term: null, ro: true, theme: 'auto', fs: 100,
  view: 'file', line: null, branch: null, commit: null,
  panel: 'files', query: '', caseSensitive: false, exclude: DEFAULT_EXCLUDE, lang: null,
};

const TERM_RE = /^t_[\w-]+$/;
const COMMIT_RE = /^[0-9a-f]{4,64}$/i;
const GIT_ROUTE = '-/git';
const FILE_ROUTE = '-/file/';

function encodePath(p: string): string {
  return p.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

function parseLine(value: string | null): LineRange | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(value ?? '');
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2] ?? m[1]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0 && end >= start
    ? { start, end } : null;
}

/** 统一解析所有地址栏状态；非法参数回退，互斥资源只保留有效目标。 */
export function parseUrl(href: string): UrlState {
  const url = new URL(href);
  const q = url.searchParams;
  const s = { ...DEFAULT_STATE };
  try {
    s.path = decodeURIComponent(url.pathname).slice(1) || null;
  } catch { /* 畸形编码 → 空态，其余参数仍可恢复 */ }
  const term = q.get('term');
  s.term = term && TERM_RE.test(term) ? term : null;
  let commit: string | null = null;
  if (s.path?.startsWith(FILE_ROUTE)) {
    // 显式文件路由只解包一次，连名为 -/file/... 的文件也能无歧义表示。
    s.path = s.path.slice(FILE_ROUTE.length) || null;
  } else if (s.path === GIT_ROUTE || s.path?.startsWith(`${GIT_ROUTE}/`)) {
    const route = s.path.slice(GIT_ROUTE.length + 1);
    s.path = null;
    s.view = 'git';
    if (route === 'history' || route === 'history/') s.view = 'history';
    else if (route === 'branches' || route === 'branches/') s.view = 'branches';
    else if (route.startsWith('diff/')) {
      s.view = 'diff';
      s.path = route.slice('diff/'.length) || null;
    } else if (route.startsWith('commit/')) {
      s.view = 'commit';
      commit = route.slice('commit/'.length);
    }
  }
  if (s.view === 'commit') {
    if (commit && COMMIT_RE.test(commit)) s.commit = commit;
    else s.view = 'git';
  }
  if (s.view === 'diff' && !s.path) s.view = 'git';
  if (s.term) {
    s.view = 'file';
    s.path = null;
    s.commit = null;
  } else if (s.view !== 'file' && s.view !== 'diff') {
    s.path = null;
  }
  if (s.view === 'file' && s.path) s.line = parseLine(q.get('line'));
  if (s.view === 'history') s.branch = q.get('branch') || null;

  s.ro = q.get('ro') !== '0';
  const theme = q.get('theme');
  if (theme === 'light' || theme === 'dark') s.theme = theme;
  const fs = q.get('fs');
  if (fs && Number.isFinite(Number(fs))) s.fs = Math.min(130, Math.max(85, Number(fs)));
  const lang = q.get('lang');
  if (lang === 'en' || lang === 'zh') s.lang = lang;
  const panel = q.get('panel');
  if (panel === 'tabs' || panel === 'search') s.panel = panel;
  if (s.panel === 'search') {
    s.query = q.get('q') ?? '';
    s.caseSensitive = q.get('case') === '1';
    s.exclude = q.get('exclude') ?? DEFAULT_EXCLUDE;
  }
  return s;
}

export function serializeUrl(state: UrlState): string {
  const params = new URLSearchParams();
  const view = state.term ? 'file' : state.view;
  if (state.term) params.set('term', state.term);
  if (!state.ro) params.set('ro', '0');
  if (state.theme !== 'auto') params.set('theme', state.theme);
  if (state.fs !== 100) params.set('fs', String(state.fs));
  if (state.lang) params.set('lang', state.lang);
  const path = !state.term && (view === 'file' || view === 'diff') ? state.path : null;
  if (view === 'file' && path && state.line) {
    const { start, end } = state.line;
    params.set('line', start === end ? String(start) : `${start}-${end}`);
  }
  if (view === 'history' && state.branch) params.set('branch', state.branch);
  if (state.panel !== 'files') params.set('panel', state.panel);
  if (state.panel === 'search') {
    if (state.query) params.set('q', state.query);
    if (state.caseSensitive) params.set('case', '1');
    if (state.exclude !== DEFAULT_EXCLUDE) params.set('exclude', state.exclude);
  }
  let pathname = '/';
  if (view === 'file' && path) {
    // 普通文件保持原有路径；保留命名空间中的文件使用显式文件路由。
    pathname = `/${path.startsWith('-/') ? FILE_ROUTE : ''}${encodePath(path)}`;
  } else if (view !== 'file') {
    pathname = `/${GIT_ROUTE}`;
    if (view === 'history' || view === 'branches') pathname += `/${view}`;
    else if (view === 'diff' && path) pathname += `/diff/${encodePath(path)}`;
    else if (view === 'commit' && state.commit && COMMIT_RE.test(state.commit)) pathname += `/commit/${state.commit}`;
  }
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ''}`;
}
