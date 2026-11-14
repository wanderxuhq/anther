// server/mcp.ts
// Validation and capability filtering for MCP servers passed to ACP sessions.
import type * as acp from '@agentclientprotocol/sdk';

const MAX_SERVERS = 20;

export function normalizeMcpServers(value: unknown): acp.McpServer[] {
  if (!Array.isArray(value)) throw new Error('servers must be an array');
  if (value.length > MAX_SERVERS) throw new Error(`at most ${MAX_SERVERS} MCP servers are allowed`);
  const names = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('invalid MCP server');
    }
    const input = entry as Record<string, unknown>;
    const name = requiredString(input.name, 'name');
    if (names.has(name)) throw new Error(`duplicate MCP server name: ${name}`);
    names.add(name);

    if (input.type === 'http' || input.type === 'sse') {
      const url = requiredString(input.url, 'command or url');
      return {
        type: input.type,
        name,
        url,
        headers: pairs(input.headers, 'headers'),
      };
    }
    if (input.type !== undefined && input.type !== 'stdio') {
      throw new Error(`unsupported MCP transport: ${String(input.type)}`);
    }
    const command = requiredString(input.command, 'command or url');
    return {
      name,
      command,
      args: strings(input.args, 'args'),
      env: pairs(input.env, 'env'),
    };
  });
}

export function filterMcpServers(
  servers: readonly acp.McpServer[],
  capabilities: { http?: boolean; sse?: boolean } | null | undefined,
): acp.McpServer[] {
  return servers.filter((server) => {
    if (!('type' in server)) return true;
    if (server.type === 'http') return capabilities?.http === true;
    return capabilities?.sse === true;
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function strings(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry) => {
    if (typeof entry !== 'string') throw new Error(`${label} must contain strings`);
    return entry;
  });
}

function pairs(value: unknown, label: string): Array<{ name: string; value: string }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label} entries must be objects`);
    }
    const pair = entry as Record<string, unknown>;
    return {
      name: requiredString(pair.name, `${label} name`),
      value: typeof pair.value === 'string' ? pair.value : '',
    };
  });
}
