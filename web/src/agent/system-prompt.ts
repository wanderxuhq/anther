// web/src/agent/system-prompt.ts
// Per-workspace persistence for the append system prompt.
import type { StorageLike } from './mcp.ts';

export const MAX_SYSTEM_PROMPT = 16_000;

export function systemPromptStorageKey(base: string): string {
  return `anther:systemPrompt:${base || '/'}`;
}

export function loadSystemPrompt(storage: StorageLike, key: string): string {
  try {
    const raw = storage.getItem(key);
    if (!raw) return '';
    const text = raw.trim();
    return text.length <= MAX_SYSTEM_PROMPT && !text.includes('\0') ? text : '';
  } catch {
    return '';
  }
}

export function storeSystemPrompt(storage: StorageLike, key: string, text: string): void {
  try {
    const value = text.trim();
    if (!value) {
      storage.removeItem?.(key);
      return;
    }
    if (value.length > MAX_SYSTEM_PROMPT) return;
    if (value.includes('\0')) return;
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable or full; the server copy still works for this run.
  }
}
