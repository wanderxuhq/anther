// web/src/agent/mcp.ts
// Persistence and small parsers for the MCP server manager.
import type { McpHeader, McpServer } from './api.ts';

export type { McpHeader, McpServer };

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export function mcpStorageKey(base: string): string {
  return `anther:mcp:${base || '/'}`;
}

export function loadMcpServers(storage: StorageLike, key: string): McpServer[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.map(validMcpServer).filter((server): server is McpServer => server !== null);
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
  if (server.type === 'http' || server.type === 'sse') {
    if (typeof server.url !== 'string' || !server.url.trim()) return null;
    return {
      type: server.type,
      name: server.name,
      url: server.url,
      headers: validHeaders(server.headers),
    };
  }
  if (server.type !== 'stdio' || typeof server.command !== 'string' || !server.command.trim()) return null;
  return {
    type: 'stdio',
    name: server.name,
    command: server.command,
    args: Array.isArray(server.args)
      ? server.args.filter((arg): arg is string => typeof arg === 'string')
      : [],
    env: validHeaders(server.env),
  };
}

function validHeaders(value: unknown): McpHeader[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const header = entry as Record<string, unknown>;
    if (typeof header.name !== 'string' || typeof header.value !== 'string') return [];
    return [{ name: header.name, value: header.value }];
  });
}
