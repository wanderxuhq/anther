import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RequestError } from '@agentclientprotocol/sdk';
import { FileStore } from './files.ts';
import { AgentFileSystem } from './agent-fs.ts';
import { canCreateFileSymlink, makeSymlink } from './test-support.ts';

let root: string;
let outside: string;
let files: AgentFileSystem;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-fs-'));
  outside = await mkdtemp(path.join(tmpdir(), 'anther-agent-fs-outside-'));
  await writeFile(path.join(root, 'a.txt'), 'one\ntwo\nthree\n');
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  files = new AgentFileSystem(root, new FileStore(root));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

function isInvalidParams(error: unknown): boolean {
  return error instanceof RequestError && error.code === -32602;
}

function isNotFound(error: unknown): boolean {
  return error instanceof RequestError && error.code === -32002;
}

test('reads a workspace file by absolute path', async () => {
  const result = await files.readTextFile({
    sessionId: 'sess_1',
    path: path.join(root, 'a.txt'),
  });
  assert.deepEqual(result, { content: 'one\ntwo\nthree\n' });
});

test('reads a 1-based line range', async () => {
  const result = await files.readTextFile({
    sessionId: 'sess_1',
    path: path.join(root, 'a.txt'),
    line: 2,
    limit: 1,
  });
  assert.equal(result.content, 'two');
});

test('rejects relative paths and paths outside the workspace', async () => {
  await assert.rejects(
    files.readTextFile({ sessionId: 'sess_1', path: 'a.txt' }),
    isInvalidParams,
  );
  await assert.rejects(
    files.readTextFile({ sessionId: 'sess_1', path: path.join(outside, 'secret.txt') }),
    isInvalidParams,
  );
  await assert.rejects(
    files.writeTextFile({ sessionId: 'sess_1', path: path.join(outside, 'new.txt'), content: 'x' }),
    isInvalidParams,
  );
});

test('writes a new nested file and creates parent directories', async () => {
  const target = path.join(root, 'nested', 'dir', 'new.txt');
  const result = await files.writeTextFile({
    sessionId: 'sess_1',
    path: target,
    content: 'hello',
  });
  assert.deepEqual(result, {});
  assert.equal(await readFile(target, 'utf8'), 'hello');
});

test('overwrites an existing file', async () => {
  await files.writeTextFile({
    sessionId: 'sess_1',
    path: path.join(root, 'a.txt'),
    content: 'changed',
  });
  assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'changed');
});

test('rejects symlink escapes on read and write', { skip: !canCreateFileSymlink() }, async () => {
  await makeSymlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  await assert.rejects(
    files.readTextFile({ sessionId: 'sess_1', path: path.join(root, 'link.txt') }),
    isInvalidParams,
  );
  await assert.rejects(
    files.writeTextFile({ sessionId: 'sess_1', path: path.join(root, 'link.txt'), content: 'x' }),
    isInvalidParams,
  );
});

test('accepts paths through a symlinked workspace root', async () => {
  const real = await mkdtemp(path.join(tmpdir(), 'anther-agent-fs-real-'));
  const link = await mkdtemp(path.join(tmpdir(), 'anther-agent-fs-link-'));
  const linked = path.join(link, 'workspace');
  await makeSymlink(real, linked, 'dir');
  await writeFile(path.join(real, 'a.txt'), 'real');
  const linkedFiles = new AgentFileSystem(linked, new FileStore(linked));
  try {
    const result = await linkedFiles.readTextFile({
      sessionId: 'sess_1',
      path: path.join(real, 'a.txt'),
    });
    assert.equal(result.content, 'real');
    await linkedFiles.writeTextFile({
      sessionId: 'sess_1',
      path: path.join(real, 'new.txt'),
      content: 'new',
    });
    assert.equal(await readFile(path.join(real, 'new.txt'), 'utf8'), 'new');
  } finally {
    await rm(real, { recursive: true, force: true });
    await rm(link, { recursive: true, force: true });
  }
});

test('maps a missing file to resource-not-found', async () => {
  await assert.rejects(
    files.readTextFile({ sessionId: 'sess_1', path: path.join(root, 'missing.txt') }),
    isNotFound,
  );
});

test('creates a missing parent directory for writes', async () => {
  const target = path.join(root, 'deep', 'file.txt');
  await mkdir(path.join(root, 'deep'), { recursive: true });
  await files.writeTextFile({ sessionId: 'sess_1', path: target, content: 'x' });
  assert.equal(await readFile(target, 'utf8'), 'x');
});
