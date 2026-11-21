import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpServer } from '../http.ts';
import { SkillManager } from '../skills.ts';
import { registerSkillRoutes } from './skills.ts';
import { canCreateFileSymlink, makeSymlink } from '../test-support.ts';

let root: string;
let server: HttpServer;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-skills-api-'));
  const skill = path.join(root, 'source', 'demo-skill');
  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, 'SKILL.md'), [
    '---',
    'name: demo-skill',
    'description: A demo skill used by anther tests.',
    '---',
    '',
    '# Demo skill',
    '',
  ].join('\n'));

  server = new HttpServer({ staticDir: '' });
  registerSkillRoutes(server, new SkillManager(root));
  await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

async function call(method: string, pathname: string, body?: unknown) {
  const res = await fetch(base + pathname, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

test('GET /_/agent/api/skills returns installed skills, targets and agent names', async () => {
  const { status, body } = await call('GET', '/_/agent/api/skills');
  assert.equal(status, 200);
  assert.deepEqual(body.skills, []);
  assert.ok(Array.isArray(body.targets) && body.targets.length > 0);
  assert.equal(typeof body.agents, 'object');
  assert.equal(typeof body.agents.opencode, 'string');

  const targets = await call('GET', '/_/agent/api/skills/targets');
  assert.equal(targets.status, 200);
  assert.ok(Array.isArray(targets.body.data) && targets.body.data.length > 0);
});

test('POST /_/agent/api/skills/resolve validates the source', async () => {
  assert.equal((await call('POST', '/_/agent/api/skills/resolve', {})).status, 400);
  assert.equal((await call('POST', '/_/agent/api/skills/resolve', { source: '   ' })).status, 400);

  const outside = await call('POST', '/_/agent/api/skills/resolve', { source: '../outside' });
  assert.equal(outside.status, 400);
  assert.match(outside.body.error, /SKILLS_LOCAL_SOURCE_OUTSIDE_WORKSPACE/);

  const missing = await call('POST', '/_/agent/api/skills/resolve', { source: './missing' });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /SKILLS_LOCAL_PATH_NOT_FOUND/);
});

test('resolves, installs, lists and removes a local skill over HTTP', async () => {
  const preview = await call('POST', '/_/agent/api/skills/resolve', { source: './source' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.skills.length, 1);
  assert.equal(preview.body.skills[0].name, 'demo-skill');
  const token = preview.body.token as string;
  assert.ok(token);

  const list = await call('GET', '/_/agent/api/skills');
  const target = list.body.targets[0] as { id: string; dir: string };

  const installed = await call('POST', '/_/agent/api/skills/install', {
    token,
    skills: ['demo-skill'],
    agents: [target.id],
  });
  assert.equal(installed.status, 200);
  assert.deepEqual(installed.body.failed, []);
  assert.equal(installed.body.installed.length, 1);
  assert.equal(installed.body.installed[0].path, `${target.dir}/demo-skill`);

  const afterInstall = await call('GET', '/_/agent/api/skills');
  const found = afterInstall.body.skills.find((skill: { name: string }) => skill.name === 'demo-skill');
  assert.ok(found);
  assert.ok(found.agents.includes(target.id));

  const removed = await call('POST', '/_/agent/api/skills/remove', { name: 'demo-skill' });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.removed, ['demo-skill']);

  const afterRemove = await call('GET', '/_/agent/api/skills');
  assert.equal(
    afterRemove.body.skills.some((skill: { name: string }) => skill.name === 'demo-skill'),
    false,
  );
});

test('strict install failures map to 400 and keep the preview usable', { skip: !canCreateFileSymlink() }, async () => {
  const bad = path.join(root, 'source', 'bad-skill');
  await mkdir(bad, { recursive: true });
  await writeFile(path.join(bad, 'SKILL.md'), [
    '---',
    'name: bad-skill',
    'description: A skill with a symlink.',
    '---',
  ].join('\n'));
  await makeSymlink('SKILL.md', path.join(bad, 'link.md'));

  const preview = await call('POST', '/_/agent/api/skills/resolve', { source: './source' });
  const list = await call('GET', '/_/agent/api/skills');
  const target = list.body.targets[0] as { id: string };

  const rejected = await call('POST', '/_/agent/api/skills/install', {
    token: preview.body.token,
    skills: ['bad-skill'],
    agents: [target.id],
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /SKILLS_SKILL_CONTAINS_SYMLINKS/);

  const retry = await call('POST', '/_/agent/api/skills/install', {
    token: preview.body.token,
    skills: ['demo-skill'],
    agents: [target.id],
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.installed.length, 1);
});

test('install validates token, skills and agents', async () => {
  const missingToken = await call('POST', '/_/agent/api/skills/install', { skills: ['a'] });
  assert.equal(missingToken.status, 400);

  const badSkills = await call('POST', '/_/agent/api/skills/install', {
    token: 'missing',
    skills: 'demo-skill',
  });
  assert.equal(badSkills.status, 400);

  const missingPreview = await call('POST', '/_/agent/api/skills/install', {
    token: 'missing',
    skills: ['demo-skill'],
  });
  assert.equal(missingPreview.status, 400);
  assert.match(missingPreview.body.error, /SKILLS_PREVIEW_EXPIRED/);

  const preview = await call('POST', '/_/agent/api/skills/resolve', { source: './source' });
  const emptyAgents = await call('POST', '/_/agent/api/skills/install', {
    token: preview.body.token,
    skills: ['demo-skill'],
    agents: [],
  });
  assert.equal(emptyAgents.status, 400);
  await call('POST', '/_/agent/api/skills/dispose', { token: preview.body.token });
});

test('dispose is idempotent', async () => {
  const preview = await call('POST', '/_/agent/api/skills/resolve', { source: './source' });
  const first = await call('POST', '/_/agent/api/skills/dispose', { token: preview.body.token });
  assert.equal(first.status, 200);
  assert.equal(first.body.disposed, true);
  const second = await call('POST', '/_/agent/api/skills/dispose', { token: preview.body.token });
  assert.equal(second.status, 200);
  assert.equal(second.body.disposed, false);
});
