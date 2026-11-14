// web/src/agent/external.ts
// URL validation for external elicitations and links.

export function externalHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
