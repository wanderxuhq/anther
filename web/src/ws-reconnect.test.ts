import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectReconnecting } from './ws-reconnect.ts';

class FakeSocket {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(data: unknown) { this.onmessage?.({ data }); }
  serverClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

function setup(t: { mock: { timers: { enable(options: { apis: string[] }): void; tick(ms: number): void } } }) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets: FakeSocket[] = [];
  const opens: number[] = [];
  const messages: unknown[] = [];
  const disconnects: number[] = [];
  const conn = connectReconnecting({
    url: 'ws://test',
    onOpen: () => { opens.push(opens.length + 1); },
    onMessage: (_socket, event) => { messages.push(event.data); },
    onDisconnect: () => { disconnects.push(disconnects.length + 1); },
    shouldStop: (event) => event.code === 4404,
  }, (url) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  return { conn, sockets, opens, messages, disconnects };
}

test('opens once, reports connecting, and sends only when open', (t) => {
  const { conn, sockets, opens, messages } = setup(t);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'ws://test');
  assert.equal(conn.connecting(), true);
  assert.equal(conn.send('queued'), false);

  sockets[0].open();
  assert.equal(opens.length, 1);
  assert.equal(conn.connecting(), false);
  assert.equal(conn.send('{"type":"ping"}'), true);
  assert.deepEqual(sockets[0].sent, ['{"type":"ping"}']);

  sockets[0].receive('frame');
  assert.deepEqual(messages, ['frame']);
});

test('reconnects with 500ms then 1000ms backoff', (t) => {
  const { sockets } = setup(t);
  sockets[0].serverClose();
  t.mock.timers.tick(499);
  assert.equal(sockets.length, 1);
  t.mock.timers.tick(1);
  assert.equal(sockets.length, 2);

  sockets[1].serverClose();
  t.mock.timers.tick(999);
  assert.equal(sockets.length, 2);
  t.mock.timers.tick(1);
  assert.equal(sockets.length, 3);
});

test('a successful open resets the backoff', (t) => {
  const { sockets } = setup(t);
  sockets[0].serverClose();
  t.mock.timers.tick(500);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  sockets[1].serverClose();
  t.mock.timers.tick(500);
  assert.equal(sockets.length, 3);
});

test('ignores frames from a superseded socket', (t) => {
  const { sockets, opens, messages } = setup(t);
  sockets[0].serverClose();
  t.mock.timers.tick(500);
  assert.equal(sockets.length, 2);
  sockets[0].receive('stale');
  sockets[0].open();
  assert.deepEqual(messages, []);
  assert.equal(opens.length, 0);
});

test('shouldStop prevents reconnecting and skips onDisconnect', (t) => {
  const { sockets, disconnects } = setup(t);
  sockets[0].serverClose(4404);
  t.mock.timers.tick(5_000);
  assert.equal(sockets.length, 1);
  assert.deepEqual(disconnects, []);
});

test('onDisconnect runs before a scheduled reconnect', (t) => {
  const { sockets, disconnects } = setup(t);
  sockets[0].serverClose();
  assert.deepEqual(disconnects, [1]);
  t.mock.timers.tick(500);
  assert.equal(sockets.length, 2);
});

test('dispose closes the socket and stops reconnecting', (t) => {
  const { conn, sockets } = setup(t);
  conn.dispose();
  assert.equal(sockets[0].closed, true);
  sockets[0].serverClose();
  t.mock.timers.tick(5_000);
  assert.equal(sockets.length, 1);
});
