// server/ws-send.ts
// Shared WebSocket JSON sender: skip frames when the socket is no longer open.

export type JsonSocket = { readyState: number; send(data: string): void };

/** WebSocket.OPEN (RFC 6455); kept local so this helper has no runtime dependency on `ws`. */
const OPEN = 1;

/** Returns true when the frame was sent. */
export function sendWsJson(ws: JsonSocket, message: unknown): boolean {
  if (ws.readyState !== OPEN) return false;
  const data = JSON.stringify(message);
  if (data === undefined) return false;
  ws.send(data);
  return true;
}
