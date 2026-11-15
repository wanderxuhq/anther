// web/src/ws-reconnect.ts
// Shared reconnecting WebSocket lifecycle: exponential backoff, current-socket
// filtering, explicit stop/dispose. Protocol-specific handlers stay in callers.

const WS_OPEN = 1;
const WS_CONNECTING = 0;

export type ReconnectSocket = {
  current(): WebSocket | null;
  /** True while the current socket is still connecting. */
  connecting(): boolean;
  /** Send only when OPEN; returns false when queued/closed. */
  send(data: string): boolean;
  /** Stop reconnecting but keep the socket (caller may close it). */
  stop(): void;
  /** Stop reconnecting and close the current socket. */
  dispose(): void;
};

export type ReconnectOptions = {
  url: string | (() => string);
  onOpen(socket: WebSocket): void;
  onMessage(socket: WebSocket, event: MessageEvent): void;
  /** Return true to permanently stop (e.g. terminal deleted / explicit exit). */
  shouldStop?(event: CloseEvent): boolean;
  /** Called before scheduling a reconnect; reject queued work here. */
  onDisconnect?(): void;
  backoff?: { baseMs?: number; maxMs?: number };
};

export type SocketFactory = (url: string) => WebSocket;

export function connectReconnecting(
  options: ReconnectOptions,
  create: SocketFactory = (url) => new WebSocket(url),
): ReconnectSocket {
  const baseMs = options.backoff?.baseMs ?? 500;
  const maxMs = options.backoff?.maxMs ?? 8000;
  let ws: WebSocket | null = null;
  let disposed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (disposed) return;
    const socket = create(typeof options.url === 'function' ? options.url() : options.url);
    ws = socket;
    socket.onopen = () => {
      if (socket !== ws) return;
      attempt = 0;
      options.onOpen(socket);
    };
    socket.onmessage = (event) => {
      if (socket !== ws) return;
      options.onMessage(socket, event);
    };
    socket.onclose = (event) => {
      if (socket !== ws) return;
      ws = null;
      if (disposed || options.shouldStop?.(event)) return;
      options.onDisconnect?.();
      timer = setTimeout(open, Math.min(baseMs * 2 ** attempt, maxMs));
      attempt += 1;
    };
    socket.onerror = () => { /* onclose owns reconnecting */ };
  };
  open();

  return {
    current: () => ws,
    connecting: () => ws?.readyState === WS_CONNECTING,
    send(data) {
      if (!ws || ws.readyState !== WS_OPEN) return false;
      ws.send(data);
      return true;
    },
    stop() {
      disposed = true;
      clearTimeout(timer);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
