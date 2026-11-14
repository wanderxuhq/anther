// web/src/agent/terminal.ts
// Pure helpers for ACP terminal tool-call content.

/** Collect stable, unique terminal ids from ACP ToolCallContent parts. */
export function terminalIdsFromContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const value = part as { type?: unknown; terminalId?: unknown };
    if (value.type !== 'terminal' || typeof value.terminalId !== 'string' || !value.terminalId) continue;
    if (seen.has(value.terminalId)) continue;
    seen.add(value.terminalId);
    ids.push(value.terminalId);
  }
  return ids;
}

/** Strip terminal control sequences so output is safe in a plain <pre>. */
export function stripTerminalControl(text: string): string {
  if (!text) return '';
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()#][0-9A-Za-z]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
