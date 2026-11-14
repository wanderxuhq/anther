import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverAgent, discoverAgents, type AgentProfile } from './agent-profiles.ts';

const opencode: AgentProfile = { id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['acp'] };
const commandCode: AgentProfile = { id: 'command-code', name: 'Command Code', command: 'command-code', args: ['acp'] };

async function executable(dir: string, name: string): Promise<void> {
  const file = path.join(dir, name);
  await writeFile(file, '#!/bin/sh\nexit 0\n');
  await chmod(file, 0o755);
}

test('discovers a native ACP agent from PATH', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anther-agent-'));
  try {
    await executable(dir, 'opencode');
    const found = await discoverAgent({
      env: { PATH: dir },
      platform: 'linux',
      home: dir,
      profiles: [opencode, commandCode],
    });
    assert.equal(found?.profile.id, 'opencode');
    assert.equal(found?.executable, path.join(dir, 'opencode'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falls back to the next available native ACP agent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anther-agent-'));
  try {
    await executable(dir, 'command-code');
    const found = await discoverAgent({
      env: { PATH: dir },
      platform: 'linux',
      home: dir,
      profiles: [opencode, commandCode],
    });
    assert.equal(found?.profile.id, 'command-code');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prefers OpenCode when both are installed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anther-agent-'));
  try {
    await executable(dir, 'opencode');
    await executable(dir, 'command-code');
    const found = await discoverAgent({
      env: { PATH: dir },
      platform: 'linux',
      home: dir,
      profiles: [opencode, commandCode],
    });
    assert.equal(found?.profile.id, 'opencode');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test('discovers every available native ACP agent in priority order', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anther-agent-'));
  try {
    await executable(dir, 'command-code');
    await executable(dir, 'opencode');
    const found = await discoverAgents({
      env: { PATH: dir },
      platform: 'linux',
      home: dir,
      profiles: [opencode, commandCode],
    });
    assert.deepEqual(found.map((entry) => entry.profile.id), ['opencode', 'command-code']);
    assert.equal(found[0].executable, path.join(dir, 'opencode'));
    assert.equal(found[1].executable, path.join(dir, 'command-code'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('returns undefined when no native ACP agent is available', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anther-agent-'));
  try {
    const found = await discoverAgent({
      env: { PATH: dir },
      platform: 'linux',
      home: dir,
      profiles: [opencode, commandCode],
    });
    assert.equal(found, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
