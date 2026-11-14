// web/src/agent/mcp.ts
// Persistence and small parsers for the MCP server manager.
import type { McpHeader, McpServer } from './api.ts';

export type { McpHeader, McpServer };

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

const MAX_SERVERS = 20;
const MAX_URL = 2048;

export function mcpStorageKey(base: string): string {
  return `anther:mcp:${base || '/'}`;
}

export function loadMcpServers(storage: StorageLike, key: string): McpServer[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const servers: McpServer[] = [];
    const names = new Set<string>();
    for (const entry of value) {
      const server = validMcpServer(entry);
      if (!server || names.has(server.name)) continue;
      names.add(server.name);
      servers.push(server);
      if (servers.length >= MAX_SERVERS) break;
    }
    return servers;
  } catch {
    return [];
  }
}

export function storeMcpServers(storage: StorageLike, key: string, servers: McpServer[]): void {
  try {
    storage.setItem(key, JSON.stringify(servers));
  } catch {
    // Storage can be unavailable or full; the server copy still works for this run.
  }
}

export function parseLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function parseKeyValueLines(value: string, delimiter: '=' | ':'): McpHeader[] {
  const pairs: McpHeader[] = [];
  for (const line of value.split(/\r?\n/)) {
    const index = line.indexOf(delimiter);
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    const item = line.slice(index + 1).trim();
    if (!name) continue;
    pairs.push({ name, value: item });
  }
  return pairs;
}

function validMcpServer(value: unknown): McpServer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const server = value as Record<string, unknown>;
  if (typeof server.name !== 'string' || !server.name.trim()) return null;
  const name = server.name.trim();
  if (name.length > 128 || /[\x00-\x1f\x7f]/.test(name)) return null;
  if (server.type === 'http' || server.type === 'sse') {
    if (typeof server.url !== 'string' || !validUrl(server.url)) return null;
    const headers = validPairs(server.headers, 'headers');
    if (!headers) return null;
    return {
      type: server.type,
      name,
      url: server.url.trim(),
      headers,
    };
  }
  // Accept type-less stdio entries too: the ACP stdio shape does not carry a
  // type, and older browser snapshots may have persisted that shape.
  if (server.type !== undefined && server.type !== 'stdio') return null;
  if (typeof server.command !== 'string' || !server.command.trim()) return null;
  const command = server.command.trim();
  if (command.length > 4096 || /[\x00-\x1f\x7f]/.test(command)) return null;
  const args = validArgs(server.args);
  const env = validPairs(server.env, 'env');
  if (!args || !env) return null;
  return {
    type: 'stdio',
    name,
    command,
    args,
    env,
  };
}

function validUrl(value: string): boolean {
  const raw = value.trim();
  if (!raw || raw.length > MAX_URL || /[\x00-\x1f\x7f]/.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validArgs(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 128) return null;
  if (!value.every((arg) => typeof arg === 'string' && arg.length <= 8192 && !arg.includes('\0'))) {
    return null;
  }
  return value as string[];
}

function validPairs(value: unknown, kind: 'headers' | 'env'): McpHeader[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 64) return null;
  const seen = new Set<string>();
  const pairs: McpHeader[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const pair = entry as Record<string, unknown>;
    if (typeof pair.name !== 'string' || typeof pair.value !== 'string') return null;
    const name = pair.name.trim();
    if (!name || name.length > 128 || /[\x00-\x1f\x7f]/.test(name)) return null;
    if (kind === 'headers' && !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) return null;
    if (kind === 'env' && name.includes('=')) return null;
    if (kind === 'headers' && /[\r\n\0]/.test(pair.value)) return null;
    if (pair.value.includes('\0') || pair.value.length > 8192) return null;
    const key = kind === 'headers' ? name.toLowerCase() : name;
    if (seen.has(key)) return null;
    seen.add(key);
    pairs.push({ name, value: pair.value });
  }
  return pairs;
}
