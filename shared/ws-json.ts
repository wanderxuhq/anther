// server/ws-json.ts
// Shared WebSocket JSON envelope parser: malformed or non-object frames are ignored.

export function parseWsJson<T extends object = Record<string, unknown>>(raw: unknown): T | null {
  try {
    const value: unknown = JSON.parse(String(raw));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as T : null;
  } catch {
    return null;
  }
}
