// web/src/http-json.ts
// Shared fetch-response reader: parse JSON (or keep text) and surface the server
// error message, letting each client choose its own Error subclass.

export async function readJsonResponse(
  res: Response,
  makeError: (status: number, message: string) => Error,
): Promise<unknown> {
  const text = await res.text();
  let data: unknown;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const message = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
      ? (data as { error: string }).error
      : res.statusText;
    throw makeError(res.status, message || `HTTP ${res.status}`);
  }
  return data;
}
