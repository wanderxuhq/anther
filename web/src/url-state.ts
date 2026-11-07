import { parseFragment, serializeFragment } from './url-fragment.ts';
import type { DatabaseTarget } from './tab-model.ts';
import { parseReadingLocation, writeReadingLocation, type ReadingLocation } from './readers/location.ts';
import { parseTablePosition, writeTablePosition, finiteNumber } from './preview-state.ts';
export type MainView = 'file' | 'git' | 'diff' | 'history' | 'branches' | 'commit' | 'database';
export type Panel = 'files' | 'tabs' | 'search';
/** URL 使用从 1 开始的行号，end 包含在选区内。 */
export type LineRange = { start: number; end: number };
export const DEFAULT_EXCLUDE = '.git,node_modules,dist';

export type UrlState = {
  reader: ReadingLocation | null;
  database: DatabaseTarget | null;
  path: string | null;
  term: string | null;
  ro: boolean;
  theme: 'auto' | 'light' | 'dark';
  fs: number;
  view: MainView;
  line: LineRange | null;
  entry: string | null;
  inside: string[];
  branch: string | null;
  commit: string | null;
  panel: Panel;
  query: string;
  caseSensitive: boolean;
  exclude: string;
  lang: 'en' | 'zh' | null;
};

export const DEFAULT_STATE: UrlState = {
  reader: null,
  database: null, path: null, term: null, ro: true, theme: 'auto', fs: 100,
  view: 'file', line: null, entry: null, inside: [], branch: null, commit: null,
  panel: 'files', query: '', caseSensitive: false, exclude: DEFAULT_EXCLUDE, lang: null,
};

const TERM_RE = /^t_[\w-]+$/;
const COMMIT_RE = /^[0-9a-f]{4,64}$/i;
// 前端内部路由使用 `_` 前缀，`/-/` 整个留给多工作区挂载。
const GIT_ROUTE = '_/git';
const FILE_ROUTE = '_/file/';
const DATABASE_ROUTE = '_/database/';
const ARCHIVE_EXT = /\.(?:zip|jar|war|apk|xpi|cbz|7z|rar|tar|gz|tgz|bz2|tbz|tbz2|xz|txz)$/i;

function isValidArchiveEntry(entry: string): boolean {
  return entry.length > 0
    && !/[\u0000-\u001f\u007f-\u009f]/.test(entry)
    && !entry.startsWith('/')
    && !entry.startsWith('\\')
    && !/^[a-z]:/i.test(entry)
    && !entry.split(/[\\/]/).includes('..');
}

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
export function parseUrl(href: string, base = ''): UrlState {
  const url = new URL(href);
  const q = url.searchParams;
  const position = parseFragment(url.hash);
  const s = { ...DEFAULT_STATE };
  // base 是编码后的地址前缀；先按原始 pathname 剥离，再 decode，避免目录名编码差异。
  let pathname = url.pathname;
  if (base) {
    if (pathname === base) pathname = '/';
    else if (pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length);
  }
  try {
    s.path = decodeURIComponent(pathname).slice(1) || null;
  } catch { /* 畸形编码 → 空态，其余参数仍可恢复 */ }
  const term = q.get('term');
  s.term = term && TERM_RE.test(term) ? term : null;
  let commit: string | null = null;
  if (s.path?.startsWith(FILE_ROUTE)) {
    // 显式文件路由只解包一次，连名为 -/file/... 的文件也能无歧义表示。
    s.path = s.path.slice(FILE_ROUTE.length) || null;
  } else if (s.path?.startsWith(DATABASE_ROUTE)) {
    s.path = s.path.slice(DATABASE_ROUTE.length) || null;
    s.view = 'database';
    const name = q.get('object');
    const column = q.get('sort');
    s.database = { object: name ? { name, type: q.get('type') === 'view' ? 'view' : 'table' } : null,
      mode: name && q.get('mode') === 'structure' ? 'structure' : 'data',
      ...(name && column ? { sort: { column, direction: q.get('order') === 'desc' ? 'desc' : 'asc' } } : {}) };
    if (name && s.database.mode === 'data') {
      const filterColumn = q.get('filter'), value = q.get('value'), offset = finiteNumber(position.get('offset')), cursor = position.get('cursor');
      if (filterColumn && value && value.length <= 1024) s.database.filter = { column: filterColumn, value };
      if (offset !== undefined && Number.isSafeInteger(offset) && offset > 0) s.database.offset = offset;
      if (s.database.offset && cursor && /^-?\d{1,19}$/.test(cursor) && BigInt(cursor) >= -(2n ** 63n) && BigInt(cursor) < 2n ** 63n) s.database.cursor = cursor;
      const table = parseTablePosition(position); if (table) s.database.table = table;
    }
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
  } else if (s.view !== 'file' && s.view !== 'diff' && s.view !== 'database') {
    s.path = null;
  }
  if (s.view !== 'database' || !s.path) { s.database = null; if (s.view === 'database') s.view = 'file'; }
  if ((s.view === 'file' || s.view === 'database') && s.path && ARCHIVE_EXT.test(s.path)) {
    const inside = q.getAll('inside');
    if (inside.length && inside.every((item) => ARCHIVE_EXT.test(item) && isValidArchiveEntry(item))) {
      s.inside = inside;
    }
    const entry = q.get('entry');
    if (entry && isValidArchiveEntry(entry)) s.entry = entry;
  }
  if (s.database && s.entry) s.database.archive = { entry: s.entry, chain: s.inside };
  if (s.view === 'file' && s.path) s.reader = parseReadingLocation(s.entry ?? (s.inside.length ? '' : s.path), position);
  if (s.view === 'file' && s.path && !s.reader && (s.entry || s.inside.length === 0)) s.line = parseLine(position.get('line'));
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

export function serializeUrl(state: UrlState, base = ''): string {
  const params = new URLSearchParams(), position = new URLSearchParams();
  const view = state.term ? 'file' : state.view;
  if (state.term) params.set('term', state.term);
  if (!state.ro) params.set('ro', '0');
  if (state.theme !== 'auto') params.set('theme', state.theme);
  if (state.fs !== 100) params.set('fs', String(state.fs));
  if (state.lang) params.set('lang', state.lang);
  const path = !state.term && (view === 'file' || view === 'diff' || view === 'database') ? state.path : null;
  const inside = view === 'database' ? state.database?.archive?.chain ?? [] : state.inside;
  const archiveEntry = view === 'database' ? state.database?.archive?.entry : state.entry;
  const validInside = (view === 'file' || view === 'database') && path && ARCHIVE_EXT.test(path)
    && inside.length > 0
    && inside.every((item) => ARCHIVE_EXT.test(item) && isValidArchiveEntry(item));
  if (validInside) for (const item of inside) params.append('inside', item);
  const entry = (view === 'file' || view === 'database') && path && ARCHIVE_EXT.test(path) && archiveEntry && isValidArchiveEntry(archiveEntry)
    ? archiveEntry : null;
  if (entry) params.set('entry', entry);
  if (view === 'file' && path) writeReadingLocation(position, entry ?? (validInside ? '' : path), state.reader);
  if (view === 'file' && path && !position.size && (entry || !validInside) && state.line) {
    const { start, end } = state.line;
    position.set('line', start === end ? String(start) : `${start}-${end}`);
  }
  if (view === 'database' && path && state.database?.object) {
    params.set('object', state.database.object.name);
    if (state.database.object.type === 'view') params.set('type', 'view');
    if (state.database.mode === 'structure') params.set('mode', 'structure');
    if (state.database.sort && state.database.mode === 'data') {
      params.set('sort', state.database.sort.column);
      if (state.database.sort.direction === 'desc') params.set('order', 'desc');
    }
    if (state.database.mode === 'data') {
      const { filter, offset, cursor, table } = state.database;
      if (filter?.column && filter.value && filter.value.length <= 1024) { params.set('filter', filter.column); params.set('value', filter.value); }
      if (offset && Number.isSafeInteger(offset) && offset > 0) { position.set('offset', String(offset)); if (cursor && /^-?\d{1,19}$/.test(cursor)) position.set('cursor', cursor); }
      writeTablePosition(position, table);
    }
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
    // 普通文件保持原有路径；`-`/`-/`（挂载命名空间与实例列表页）和 `_/`（内部路由）使用显式文件路由。
    const reserved = path === '-' || path.startsWith('-/') || path.startsWith('_/');
    pathname = `/${reserved ? FILE_ROUTE : ''}${encodePath(path)}`;
  } else if (view === 'database' && path) {
    pathname = `/${DATABASE_ROUTE}${encodePath(path)}`;
  } else if (view !== 'file') {
    pathname = `/${GIT_ROUTE}`;
    if (view === 'history' || view === 'branches') pathname += `/${view}`;
    else if (view === 'diff' && path) pathname += `/diff/${encodePath(path)}`;
    else if (view === 'commit' && state.commit && COMMIT_RE.test(state.commit)) pathname += `/commit/${state.commit}`;
  }
  const qs = params.toString();
  return `${base}${pathname}${qs ? `?${qs}` : ''}${serializeFragment(position)}`;
}
