import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RequestError } from '@agentclientprotocol/sdk';
import {
  AcpTerminalManager,
  type AcpTerminalEvent,
} from './agent-terminal.ts';

let root: string;
let outside: string;
let manager: AcpTerminalManager;
let events: AcpTerminalEvent[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-term-'));
  outside = await mkdtemp(path.join(tmpdir(), 'anther-agent-term-outside-'));
  events = [];
  manager = new AcpTerminalManager(root, (event) => events.push(event));
});

afterEach(async () => {
  await manager.close();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

function isNotFound(error: unknown): boolean {
  return error instanceof RequestError && error.code === -32002;
}

/** Poll a bounded condition instead of sleeping a fixed amount. Bounded by poll
 * count so a delayed timer or clock jump cannot trip a premature timeout. */
async function waitFor(check: () => boolean, label: string, maxPolls = 400): Promise<void> {
  for (let poll = 0; poll < maxPolls; poll++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test('creates a command, captures output and reports exit', async () => {
  const { terminalId } = await manager.create({
    sessionId: 'sess_1',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("hello")'],
  });

  const exit = await manager.waitForExit('sess_1', terminalId);
  assert.deepEqual(exit, { exitCode: 0, signal: null });

  const snapshot = manager.output('sess_1', terminalId);
  assert.equal(snapshot.output, 'hello');
  assert.equal(snapshot.truncated, false);
  assert.equal(snapshot.exitStatus?.exitCode, 0);

  await manager.release('sess_1', terminalId);
});

test('releases terminals for one session without touching another', async () => {
  const a = await manager.create({
    sessionId: 'sess_a',
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10000)'],
  });
  const b = await manager.create({
    sessionId: 'sess_b',
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10000)'],
  });
  await manager.closeSession('sess_a');
  assert.throws(() => manager.output('sess_a', a.terminalId), isNotFound);
  assert.equal(manager.output('sess_b', b.terminalId).output, '');
  await manager.release('sess_b', b.terminalId);
});

test('uses the workspace as the default cwd and rejects an outside cwd', async () => {
  const { terminalId } = await manager.create({
    sessionId: 'sess_1',
    command: process.execPath,
    args: ['-e', 'process.stdout.write(process.cwd())'],
  });
  await manager.waitForExit('sess_1', terminalId);
  assert.equal(manager.output('sess_1', terminalId).output, root);

  await assert.rejects(
    manager.create({
      sessionId: 'sess_1',
      command: process.execPath,
      cwd: outside,
    }),
    (error: unknown) => error instanceof RequestError && error.code === -32602,
  );
});

test('truncates from the front at a character boundary', async () => {
  const text = 'aé😀'.repeat(40);
  const { terminalId } = await manager.create({
    sessionId: 'sess_1',
    command: process.execPath,
    args: ['-e', `process.stdout.write(${JSON.stringify(text)})`],
    outputByteLimit: 10,
  });
  await manager.waitForExit('sess_1', terminalId);

  const snapshot = manager.output('sess_1', terminalId);
  assert.equal(snapshot.truncated, true);
  assert.ok(Buffer.byteLength(snapshot.output, 'utf8') <= 10);
  assert.doesNotMatch(snapshot.output, /\uFFFD/);
  assert.ok(text.endsWith(snapshot.output));
});

test('rejects a terminal when the command or cwd cannot spawn', async () => {
  await assert.rejects(
    manager.create({
      sessionId: 'sess_1',
      command: '/definitely/not/a-real-command-for-anther-tests',
    }),
    (error: unknown) => error instanceof RequestError && error.code === -32602,
  );
  await assert.rejects(
    manager.create({
      sessionId: 'sess_1',
      command: process.execPath,
      cwd: path.join(root, 'missing-directory'),
    }),
    (error: unknown) => error instanceof RequestError && error.code === -32602,
  );
  await manager.close();
});

test('rejects a symlinked cwd that escapes the workspace', async () => {
  const real = await mkdtemp(path.join(tmpdir(), 'anther-agent-term-real-'));
  const link = await mkdtemp(path.join(tmpdir(), 'anther-agent-term-link-'));
  const linked = path.join(link, 'workspace');
  const escape = path.join(linked, 'escape');
  await symlink(real, linked, 'dir');
  await symlink(outside, escape, 'dir');
  const linkedManager = new AcpTerminalManager(linked, () => {});
  try {
    await assert.rejects(
      linkedManager.create({
        sessionId: 'sess_1',
        command: process.execPath,
        cwd: escape,
      }),
      (error: unknown) => error instanceof RequestError && error.code === -32602,
    );
  } finally {
    await linkedManager.close();
    await rm(real, { recursive: true, force: true });
    await rm(link, { recursive: true, force: true });
  }
});

test('accepts a cwd through a symlinked workspace root', async () => {
  const real = await mkdtemp(path.join(tmpdir(), 'anther-agent-term-real-'));
  const link = await mkdtemp(path.join(tmpdir(), 'anther-agent-term-link-'));
  const linked = path.join(link, 'workspace');
  await symlink(real, linked, 'dir');
  const linkedManager = new AcpTerminalManager(linked, () => {});
  try {
    const { terminalId } = await linkedManager.create({
      sessionId: 'sess_1',
      command: process.execPath,
      cwd: real,
      args: ['-e', 'process.stdout.write(process.cwd())'],
    });
    await linkedManager.waitForExit('sess_1', terminalId);
    assert.equal(linkedManager.output('sess_1', terminalId).output, real);
  } finally {
    await linkedManager.close();
    await rm(real, { recursive: true, force: true });
    await rm(link, { recursive: true, force: true });
  }
});

test('decodes a multi-byte UTF-8 character split across pipe chunks', async () => {
  const { terminalId } = await manager.create({
    sessionId: 'sess_1',
    command: process.execPath,
    args: [
      '-e',
      'process.stdout.write(Buffer.from([0xe4])); setTimeout(() => process.stdout.write(Buffer.from([0xb8, 0xad])), 40)',
    ],
  });
  await manager.waitForExit('sess_1', terminalId);
  assert.equal(manager.output('sess_1', terminalId).output, '中');
});

test('returns resource-not-found for unknown terminal ids', async () => {
  await assert.rejects(
    async () => manager.output('sess_1', 'missing'),
    isNotFound,
  );
  await assert.rejects(
    async () => manager.waitForExit('sess_1', 'missing'),
    isNotFound,
  );
  await assert.rejects(
    async () => manager.kill('sess_1', 'missing'),
    isNotFound,
  );
  await manager.release('sess_1', 'missing');
});

test('kills a running command and releases the terminal', async () => {
  const { terminalId } = await manager.create({
    sessionId: 'sess_1',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'],
  });
  // Wait until the command has actually produced output, then kill it.
  await waitFor(() => events.some((event) => event.terminalID === terminalId && event.output.includes('ready')),
    'terminal ready output');
  await manager.kill('sess_1', terminalId);
  const exit = await manager.waitForExit('sess_1', terminalId);
  assert.equal(exit.exitCode, null);
  assert.equal(exit.signal, 'SIGTERM');
  await manager.release('sess_1', terminalId);
});

test('emits live and final output snapshots', async () => {
  const { terminalId } = await manager.create({
    sessionId: 'sess_1',
    command: process.execPath,
    args: [
      '-e',
      'process.stdout.write("a"); setTimeout(() => process.stdout.write("b"), 100)',
    ],
  });
  await manager.waitForExit('sess_1', terminalId);
  await waitFor(() => events.some((event) => event.terminalID === terminalId && event.exitStatus),
    'final terminal snapshot');

  assert.ok(events.length > 0);
  const final = events.filter((event) => event.terminalID === terminalId).at(-1);
  assert.equal(final?.output, 'ab');
  assert.equal(final?.exitStatus?.exitCode, 0);
});
