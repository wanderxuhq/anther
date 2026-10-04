/** One fragment grammar for every preview: #field:value;field:value. */
export function parseFragment(hash: string): URLSearchParams {
  const fields = new URLSearchParams();
  for (const part of hash.replace(/^#/, '').split(';')) {
    const separator = part.indexOf(':');
    if (separator < 1) continue;
    const key = part.slice(0, separator);
    if (!/^[a-z]+$/.test(key)) continue;
    try { fields.set(key, decodeURIComponent(part.slice(separator + 1))); }
    catch { /* A malformed value does not discard other valid fields. */ }
  }
  return fields;
}

export function serializeFragment(fields: URLSearchParams): string {
  // Keep LBP chapter/element separators readable; its # stays encoded as %23.
  const encode = (value: string) => encodeURIComponent(value).replace(/%40/gi, '@').replace(/%2F/gi, '/');
  const entries = [...fields].map(([key, value]) => `${key}:${encode(value)}`);
  return entries.length ? '#' + entries.join(';') : '';
}
