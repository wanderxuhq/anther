// server/system-prompt.ts
// Validation and ACP mapping for the per-workspace append system prompt.
import type * as acp from '@agentclientprotocol/sdk';

export const MAX_SYSTEM_PROMPT = 16_000;

export function normalizeSystemPrompt(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('system prompt must be a string');
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > MAX_SYSTEM_PROMPT) {
    throw new Error(`system prompt must be at most ${MAX_SYSTEM_PROMPT} characters`);
  }
  if (text.includes('\0')) throw new Error('system prompt contains a NUL byte');
  return text;
}

export function acpSystemPrompt(
  text: string | undefined,
  supported: boolean,
): acp.SystemPrompt | undefined {
  if (!text || !supported) return undefined;
  return {
    mode: 'append',
    content: [{ type: 'text', text }],
  };
}
