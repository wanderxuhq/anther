// server/mcp.ts
// Validation, wire mapping and capability filtering for MCP servers passed to ACP sessions.
import type * as acp from '@agentclientprotocol/sdk';

const MAX_SERVERS = 20;
const MAX_NAME = 128;
const MAX_URL = 2048;
const MAX_COMMAND = 4096;
const MAX_ARGS = 128;
const MAX_ARG = 8192;
const MAX_PAIRS = 64;
const MAX_PAIR_VALUE = 8192;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export type McpPair = { name: string; value: string };

/** The browser-facing shape: stdio entries always carry an explicit type. */
export type WireMcpServer =
  | { type: 'stdio'; name: string; command: string; args: string[]; env: McpPair[] }
  | { type: 'http' | 'sse'; name: string; url: string; headers: McpPair[] };

export function normalizeMcpServers(value: unknown): acp.McpServer[] {
  if (!Array.isArray(value)) throw new Error('servers must be an array');
  if (value.length > MAX_SERVERS) throw new Error(`at most ${MAX_SERVERS} MCP servers are allowed`);
  const names = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('invalid MCP server');
    }
    const input = entry as Record<string, unknown>;
    const name = text(input.name, 'name', MAX_NAME);
    if (names.has(name)) throw new Error(`duplicate MCP server name: ${name}`);
    names.add(name);

    if (input.type === 'http' || input.type === 'sse') {
      return {
        type: input.type,
        name,
        url: httpUrl(input.url),
        headers: pairs(input.headers, 'headers'),
      };
    }
    if (input.type !== undefined && input.type !== 'stdio') {
      throw new Error(`unsupported MCP transport: ${String(input.type)}`);
    }
    return {
      name,
      command: command(input.command),
      args: strings(input.args, 'args'),
      env: pairs(input.env, 'env'),
    };
  });
}

/** Convert ACP stdio entries (which have no `type`) into the browser contract. */
export function wireMcpServers(servers: readonly acp.McpServer[]): WireMcpServer[] {
  return servers.map((server) => {
    const type = (server as { type?: string }).type;
    if (type === 'http' || type === 'sse') {
      const remote = server as acp.McpServerHttp;
      return {
        type,
        name: remote.name,
        url: remote.url,
        headers: clonePairs(remote.headers),
      };
    }
    const stdio = server as acp.McpServerStdio;
    return {
      type: 'stdio',
      name: stdio.name,
      command: stdio.command,
      args: [...(stdio.args ?? [])],
      env: clonePairs(stdio.env),
    };
  });
}

export function mcpServersEqual(
  a: readonly acp.McpServer[],
  b: readonly acp.McpServer[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((server, index) => {
    const other = b[index];
    return other !== undefined && JSON.stringify(server) === JSON.stringify(other);
  });
}

export function filterMcpServers(
  servers: readonly acp.McpServer[],
  capabilities: { http?: boolean; sse?: boolean } | null | undefined,
): acp.McpServer[] {
  return servers.filter((server) => {
    const type = (server as { type?: string }).type;
    if (type === undefined || type === 'stdio') return true;
    if (type === 'http') return capabilities?.http === true;
    return capabilities?.sse === true;
  });
}

function clonePairs(pairs: ReadonlyArray<{ name: string; value: string }> | undefined): McpPair[] {
  return (pairs ?? []).map((pair) => ({ name: pair.name, value: pair.value }));
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  const result = value.trim();
  if (result.length > max) throw new Error(`${label} is too long`);
  if (/[\x00-\x1f\x7f]/.test(result)) throw new Error(`${label} contains control characters`);
  return result;
}

function command(value: unknown): string {
  const result = text(value, 'command or url', MAX_COMMAND);
  return result;
}

function httpUrl(value: unknown): string {
  const raw = text(value, 'url', MAX_URL);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('url must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must use http or https');
  }
  return raw;
}

function strings(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > MAX_ARGS) throw new Error(`${label} has too many entries`);
  return value.map((entry) => {
    if (typeof entry !== 'string') throw new Error(`${label} must contain strings`);
    if (entry.length > MAX_ARG) throw new Error(`${label} entry is too long`);
    if (entry.includes('\0')) throw new Error(`${label} entry contains a NUL byte`);
    return entry;
  });
}

function pairs(value: unknown, label: 'headers' | 'env'): McpPair[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > MAX_PAIRS) throw new Error(`${label} has too many entries`);
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label} entries must be objects`);
    }
    const pair = entry as Record<string, unknown>;
    const name = text(pair.name, `${label} name`, MAX_NAME);
    if (label === 'headers' && !HEADER_NAME.test(name)) {
      throw new Error(`invalid header name: ${name}`);
    }
    if (label === 'env' && name.includes('=')) {
      throw new Error(`invalid env name: ${name}`);
    }
    const key = label === 'headers' ? name.toLowerCase() : name;
    if (seen.has(key)) throw new Error(`duplicate ${label} name: ${name}`);
    seen.add(key);
    if (typeof pair.value !== 'string') {
      throw new Error(`${label} value must be a string`);
    }
    if (pair.value.length > MAX_PAIR_VALUE) {
      throw new Error(`${label} value is too long`);
    }
    if (label === 'headers' && /[\r\n\0]/.test(pair.value)) {
      throw new Error(`invalid ${label} value`);
    }
    if (pair.value.includes('\0')) {
      throw new Error(`invalid ${label} value`);
    }
    return { name, value: pair.value };
  });
}
