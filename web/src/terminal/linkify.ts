// web/src/terminal/linkify.ts
// 终端文本里的可点击目标识别：http(s) URL 和文件/目录路径（含 :line:col）。
// 纯函数，无 DOM；HTML 转义和点击行为由 render/terminal 层负责。

export type TermLink =
  | { kind: 'path'; path: string; line?: number; column?: number }
  | { kind: 'url'; url: string };

export type LinkPart = { text: string } | { link: TermLink; label: string };

const QUOTED_OR_CHUNK = /(["'`])([^"'`\n]+)\1|(\S+)/g;

const KNOWN_FILENAMES = new Set([
  'makefile', 'dockerfile', 'containerfile', 'license', 'licence', 'readme', 'changelog',
  'authors', 'contributors', 'contributing', 'codeowners', 'notice',
  '.gitignore', '.gitattributes', '.dockerignore', '.editorconfig', '.npmrc', '.nvmrc',
  '.prettierrc', '.eslintrc', '.babelrc', '.env', '.bashrc', '.bash_profile', '.zshrc',
  '.profile', '.vimrc', '.tmux.conf',
]);

const KNOWN_EXTENSIONS = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'json5',
  'md', 'markdown', 'mdx', 'txt', 'rst', 'adoc', 'org',
  'css', 'scss', 'sass', 'less', 'styl', 'html', 'htm', 'xml', 'svg', 'vue', 'svelte',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'config', 'properties', 'lock',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'clj', 'cljs',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'fs', 'php', 'swift', 'm', 'mm',
  'sql', 'db', 'sqlite', 'sqlite3', 'graphql', 'gql', 'proto',
  'csv', 'tsv', 'log', 'diff', 'patch',
  'pdf', 'epub', 'mobi', 'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif', 'tif', 'tiff',
  'mp3', 'wav', 'ogg', 'flac', 'mp4', 'webm', 'mov', 'mkv', 'avi',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'wasm', 'map', 'env', 'example', 'sample', 'template', 'dist',
]);

function isUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

/** 路径候选（不含 URL）。斜杠路径宽松，单文件名要求已知扩展名/文件名，避免把版本号、域名点成文件。 */
export function looksLikePath(value: string, allowSpaces = false): boolean {
  const p = value.trim();
  if (!p || p === '.' || p === '..') return false;
  if (p.includes('://') || p.includes(':')) return false;
  if (!p.includes('/') && p.includes('@')) return false;
  if (p.startsWith('-') || p.startsWith('//')) return false;
  if (/[*?|<>]/.test(p)) return false;
  if (!allowSpaces && /\s/.test(p)) return false;
  if (p.startsWith('~')) {
    if (!p.startsWith('~/')) return false;
  }
  const body = p.endsWith('/') ? p.slice(0, -1) : p;
  if (!body) return false;
  if (body.includes('/')) {
    const segments = body.split('/').filter(Boolean);
    if (segments.length === 0) return false;
    if (segments.every((segment) => /^\d+$/.test(segment))) return false;
    return segments.some((segment) => /[A-Za-z_]/.test(segment));
  }
  const lower = body.toLowerCase();
  if (KNOWN_FILENAMES.has(lower)) return true;
  const match = body.match(/\.([A-Za-z0-9]+)$/);
  if (!match) return false;
  if (/^v?\d+(?:\.\d+)+$/i.test(body)) return false;
  return KNOWN_EXTENSIONS.has(match[1].toLowerCase());
}

function parsePathWithLine(value: string): TermLink | null {
  const match = value.match(/^(.*?)(?::(\d+))(?::(\d+))?$/);
  if (match && looksLikePath(match[1])) {
    return {
      kind: 'path',
      path: match[1],
      line: Number(match[2]),
      ...(match[3] ? { column: Number(match[3]) } : {}),
    };
  }
  return looksLikePath(value) ? { kind: 'path', path: value } : null;
}

function parseQuoted(value: string): TermLink | null {
  if (isUrl(value)) return { kind: 'url', url: value };
  const match = value.match(/^(.*?)(?::(\d+))(?::(\d+))?$/);
  if (match && looksLikePath(match[1], true)) {
    return {
      kind: 'path',
      path: match[1],
      line: Number(match[2]),
      ...(match[3] ? { column: Number(match[3]) } : {}),
    };
  }
  return looksLikePath(value, true) ? { kind: 'path', path: value } : null;
}

const TRAILING_PUNCT = /[.,;!?)\]}\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f\uff09\u300b\u300d\u300f\u3011]+$/u;
const LEADING_PUNCT = /^[([{（《「『【]+/u;

function trimUrl(value: string): { url: string; suffix: string } {
  let end = value.length;
  while (end > 0) {
    const ch = value[end - 1];
    if (',;:!?'.includes(ch) || '，。；：！？、）》」』】'.includes(ch)) { end--; continue; }
    if (ch === ')' && !value.slice(0, end).includes('(')) { end--; continue; }
    if (ch === ']' && !value.slice(0, end).includes('[')) { end--; continue; }
    if (ch === '}' && !value.slice(0, end).includes('{')) { end--; continue; }
    break;
  }
  return { url: value.slice(0, end), suffix: value.slice(end) };
}

type ParsedChunk = { prefix: string; link: TermLink; label: string; suffix: string } | { text: string };

function parseChunk(chunk: string): ParsedChunk {
  // --flag=value / key=value：只把等号右边当路径。
  const eq = chunk.indexOf('=');
  if (eq > 0 && !chunk.slice(0, eq).includes('/')) {
    const prefix = chunk.slice(0, eq + 1);
    const parsed = parseChunk(chunk.slice(eq + 1));
    if ('link' in parsed) return { ...parsed, prefix: prefix + parsed.prefix };
  }

  if (isUrl(chunk)) {
    const { url, suffix } = trimUrl(chunk);
    if (isUrl(url)) return { prefix: '', link: { kind: 'url', url }, label: url, suffix };
  }

  let core = chunk;
  let prefix = '';
  let suffix = '';

  const lead = core.match(LEADING_PUNCT);
  if (lead) { prefix += lead[0]; core = core.slice(lead[0].length); }

  const trail = core.match(TRAILING_PUNCT);
  if (trail) { suffix = trail[0] + suffix; core = core.slice(0, -trail[0].length); }

  while (core.endsWith(':') && !/:\d+(?::\d+)?$/.test(core)) {
    suffix = ':' + suffix;
    core = core.slice(0, -1);
  }
  if (/["'`]$/.test(core)) {
    suffix = core.slice(-1) + suffix;
    core = core.slice(0, -1);
  }
  if (!core) return { text: chunk };

  // **path** / _path_ / ~~path~~：保留 Markdown 包裹符，让 marked 继续加粗/斜体。
  const emphasis = core.match(/^(\*\*|__|~~|\*|_)(.+)\1$/);
  if (emphasis) {
    const wrapped = parsePathWithLine(emphasis[2]);
    if (wrapped) return { prefix: emphasis[1] + prefix, link: wrapped, label: emphasis[2], suffix: emphasis[1] + suffix };
  }

  const link = parsePathWithLine(core);
  if (!link) return { text: chunk };
  return { prefix, link, label: core, suffix };
}

/**
 * 把一行文本切成普通文本与可点击链接。保留原始空格、标点和引号；
 * 只识别 http(s) URL 与“像路径”的 token。
 */
export function splitLinks(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(QUOTED_OR_CHUNK)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index) });
    const quoted = match[1] !== undefined;
    const inner = quoted ? match[2] : match[3];
    if (quoted) {
      const link = parseQuoted(inner);
      if (link) {
        parts.push({ text: match[1] });
        parts.push({ link, label: inner });
        parts.push({ text: match[1] });
      } else {
        parts.push({ text: match[0] });
      }
    } else {
      const parsed = parseChunk(inner);
      if ('link' in parsed) {
        if (parsed.prefix) parts.push({ text: parsed.prefix });
        parts.push({ link: parsed.link, label: parsed.label });
        if (parsed.suffix) parts.push({ text: parsed.suffix });
      } else {
        parts.push({ text: match[0] });
      }
    }
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  const merged: LinkPart[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (previous && 'text' in previous && 'text' in part) previous.text += part.text;
    else merged.push(part);
  }
  return merged;
}
