// server/obsidian.ts
// Obsidian wikilink resolution over a lazy, in-memory vault path index.
// The index is workspace-scoped and rebuilds after a short TTL so newly created
// notes become visible without restarting the stateless server.
import path from 'node:path';
import type { FileStore } from './files.ts';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkdn', '.mkd'];
const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);
const INDEX_TTL_MS = 10_000;
const ALIAS_TTL_MS = 30_000;
const MAX_FILES = 100_000;
const MAX_ALIAS_FILES = 10_000;

export type ObsidianTarget = {
  path: string | null;
  heading?: string;
  block?: string;
};

/** Normalize a workspace-relative path; reject absolute, traversal and control characters. */
function normalizeRelative(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
  if (!normalized || normalized === '.') return '';
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return '';
  const parts = normalized.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.some((part) => part === '..')) return '';
  return parts.join('/');
}

const withoutExtension = (value: string): string => value.replace(/\.[^./]+$/, '');
const isMarkdownPath = (value: string): boolean => MARKDOWN_EXTENSIONS.includes(path.extname(value).toLowerCase());

function comparePaths(a: string, b: string): number {
  const markdown = Number(!isMarkdownPath(a)) - Number(!isMarkdownPath(b));
  if (markdown !== 0) return markdown;
  const segments = a.split('/').length - b.split('/').length;
  if (segments !== 0) return segments;
  const length = a.length - b.length;
  return length !== 0 ? length : a.localeCompare(b);
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitYamlList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ',') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function parseAliasesValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitYamlList(trimmed.slice(1, -1)).map(stripYamlQuotes).filter(Boolean);
  }
  return [stripYamlQuotes(trimmed)].filter(Boolean);
}

/** Read `aliases` / deprecated `alias` from a leading YAML frontmatter block. */
function frontmatterAliases(content: string): string[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return [];
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) { end = i; break; }
  }
  if (end < 0) return [];
  const aliases: string[] = [];
  for (let i = 1; i < end; i++) {
    const match = /^(?:aliases|alias):[ \t]*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const value = match[1].trim();
    if (value) {
      aliases.push(...parseAliasesValue(value));
      continue;
    }
    for (let j = i + 1; j < end; j++) {
      const item = /^[ \t]*-[ \t]*(.*?)[ \t]*$/.exec(lines[j]);
      if (!item) break;
      const alias = stripYamlQuotes(item[1]);
      if (alias) aliases.push(alias);
    }
  }
  return aliases;
}

export class ObsidianIndex {
  private readonly files: FileStore;
  private paths: string[] | null = null;
  private builtAt = 0;
  private lastMissRefresh = 0;
  private aliases: Map<string, string[]> | null = null;
  private aliasesBuiltAt = 0;

  constructor(files: FileStore) {
    this.files = files;
  }

  /**
   * Resolve `[[target#heading|alias]]` link text (already stripped of alias).
   * Returns null when the target cannot be found; heading/block suffixes are
   * preserved for the client to navigate after opening the file.
   */
  async resolve(rawTarget: string, rawFrom = ''): Promise<ObsidianTarget | null> {
    const target = rawTarget.trim();
    if (!target) return null;
    const from = normalizeRelative(rawFrom);
    const hash = target.indexOf('#');
    const filePart = (hash >= 0 ? target.slice(0, hash) : target).trim();
    const suffix = hash >= 0 ? target.slice(hash + 1) : '';
    const block = suffix.startsWith('^') ? suffix.slice(1) : undefined;
    const heading = suffix && !block ? suffix : undefined;

    if (!filePart) {
      return from ? { path: from, ...(heading ? { heading } : {}), ...(block ? { block } : {}) } : null;
    }
    const file = await this.find(filePart, from);
    if (file) return { path: file, ...(heading ? { heading } : {}), ...(block ? { block } : {}) };
    // A miss may be a note created after the cached snapshot. Rebuild at most
    // once per second so broken links cannot force a walk on every click.
    if (Date.now() - this.lastMissRefresh > 1000) {
      this.lastMissRefresh = Date.now();
      const retry = await this.find(filePart, from, true);
      if (retry) return { path: retry, ...(heading ? { heading } : {}), ...(block ? { block } : {}) };
    }
    const alias = await this.findAlias(filePart);
    if (alias) return { path: alias, ...(heading ? { heading } : {}), ...(block ? { block } : {}) };
    return null;
  }

  private async find(filePart: string, from: string, force = false): Promise<string | null> {
    const target = normalizeRelative(filePart);
    if (!target) return null;
    const paths = await this.ensurePaths(force);
    const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const hasExtension = /\.[^./]+$/.test(target);
    const names = hasExtension
      ? [target]
      : [target, ...MARKDOWN_EXTENSIONS.map((extension) => `${target}${extension}`)];

    // Exact paths win: current folder first (normal Markdown intuition), then vault root.
    const exact = new Set<string>();
    if (fromDir) for (const name of names) exact.add(`${fromDir}/${name}`);
    for (const name of names) exact.add(name);
    for (const candidate of exact) {
      if (paths.includes(candidate)) return candidate;
      const lower = candidate.toLowerCase();
      const insensitive = paths.find((item) => item.toLowerCase() === lower);
      if (insensitive) return insensitive;
    }

    // Obsidian-style fallback: match path suffixes or basenames (without `.md`).
    const targetLower = target.toLowerCase();
    const targetNoExt = withoutExtension(targetLower);
    const matches = paths.filter((item) => {
      const itemLower = item.toLowerCase();
      if (hasExtension) {
        return itemLower === targetLower
          || itemLower.endsWith(`/${targetLower}`)
          || path.posix.basename(itemLower) === path.posix.basename(targetLower);
      }
      const itemNoExt = withoutExtension(itemLower);
      return targetLower.includes('/')
        ? itemNoExt === targetNoExt || itemNoExt.endsWith(`/${targetNoExt}`)
        : path.posix.basename(itemNoExt) === targetNoExt;
    });
    if (matches.length === 0) return null;
    matches.sort(comparePaths);
    return matches[0];
  }

  private async findAlias(target: string): Promise<string | null> {
    const aliases = await this.ensureAliases();
    const matches = aliases.get(target.toLowerCase());
    return matches?.length ? [...matches].sort(comparePaths)[0] : null;
  }

  private async ensureAliases(): Promise<Map<string, string[]>> {
    if (this.aliases && Date.now() - this.aliasesBuiltAt < ALIAS_TTL_MS) return this.aliases;
    const paths = (await this.ensurePaths()).filter(isMarkdownPath).slice(0, MAX_ALIAS_FILES);
    const aliases = new Map<string, string[]>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < paths.length) {
        const file = paths[cursor++];
        try {
          const { content, utf8 } = await this.files.read(file);
          if (!utf8) continue;
          for (const alias of frontmatterAliases(content)) {
            const key = alias.toLowerCase();
            const list = aliases.get(key) ?? [];
            if (!list.includes(file)) list.push(file);
            aliases.set(key, list);
          }
        } catch { /* Unreadable note: keep indexing the rest. */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, paths.length) }, worker));
    this.aliases = aliases;
    this.aliasesBuiltAt = Date.now();
    return aliases;
  }

  private async ensurePaths(force = false): Promise<string[]> {
    if (!force && this.paths && Date.now() - this.builtAt < INDEX_TTL_MS) return this.paths;
    const paths: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      if (paths.length >= MAX_FILES) return;
      let entries;
      try {
        entries = await this.files.list(dir);
      } catch {
        return; // Unreadable folder: keep the rest of the vault usable.
      }
      for (const entry of entries) {
        if (paths.length >= MAX_FILES) return;
        if (entry.type === 'dir') {
          if (SKIP_DIRS.has(entry.name)) continue;
          await walk(dir === '.' ? entry.name : `${dir}/${entry.name}`);
        } else if (entry.type === 'file') {
          paths.push(dir === '.' ? entry.name : `${dir}/${entry.name}`);
        }
      }
    };
    await walk('.');
    this.paths = paths;
    this.builtAt = Date.now();
    this.aliases = null;
    return paths;
  }
}
