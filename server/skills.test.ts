import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentInfo } from 'skills';
import { SkillError, SkillManager, skillTargets } from './skills.ts';

const supported: AgentInfo[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    projectSkillsDir: '.agents/skills',
    globalSkillsDir: '/home/test/.config/opencode/skills',
    universal: true,
  },
  {
    id: 'command-code',
    name: 'Command Code',
    projectSkillsDir: '.commandcode/skills',
    globalSkillsDir: '/home/test/.commandcode/skills',
    universal: false,
  },
  {
    id: 'universal',
    name: 'Universal',
    projectSkillsDir: '.agents/skills',
    globalSkillsDir: '/home/test/.config/agents/skills',
    universal: true,
  },
];

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'anther-skills-'));
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
    'Say hello.',
    '',
  ].join('\n'));
  return root;
}

test('maps anther ACP agents to explicit skills targets', () => {
  assert.deepEqual(
    skillTargets(['opencode', 'command-code'], supported).map((target) => target.id),
    ['opencode', 'command-code'],
  );
  // OpenCode and universal share .agents/skills, so only the first is offered.
  assert.deepEqual(
    skillTargets(['universal', 'opencode'], supported).map((target) => target.id),
    ['opencode'],
  );
  // With no discovered ACP agent, universal remains a safe fallback.
  assert.deepEqual(
    skillTargets([], supported).map((target) => target.id),
    ['universal'],
  );
  assert.deepEqual(
    skillTargets(['unknown'], supported).map((target) => target.id),
    ['universal'],
  );
});

test('resolves, installs, lists and removes a local skill', async () => {
  const root = await workspace();
  const manager = new SkillManager(root);
  try {
    const targets = await manager.targets();
    assert.ok(targets.length > 0);
    const target = targets[0];

    const preview = await manager.resolve('./source');
    assert.equal(preview.skills.length, 1);
    assert.equal(preview.skills[0].name, 'demo-skill');
    assert.equal(preview.source.type, 'local');
    assert.equal(preview.source.url, 'source');

    const result = await manager.install(preview.token, ['demo-skill'], [target.id]);
    assert.deepEqual(result.failed, []);
    assert.equal(result.installed.length, 1);
    assert.equal(result.installed[0].path, `${target.dir}/demo-skill`);

    const listed = await manager.list();
    const found = listed.skills.find((skill) => skill.name === 'demo-skill');
    assert.ok(found);
    assert.ok(found.agents.includes(target.id));

    const removed = await manager.remove('demo-skill');
    assert.deepEqual(removed.removed, ['demo-skill']);
    const after = await manager.list();
    assert.equal(after.skills.some((skill) => skill.name === 'demo-skill'), false);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('does not consume a preview when the selected skill is unknown', async () => {
  const root = await workspace();
  const manager = new SkillManager(root);
  try {
    const target = (await manager.targets())[0];
    const preview = await manager.resolve('./source');
    await assert.rejects(
      manager.install(preview.token, ['missing-skill'], [target.id]),
      (error: unknown) => error instanceof SkillError && error.code === 'SKILLS_NO_MATCHING_SKILLS',
    );
    await assert.rejects(
      manager.install(preview.token, [], [target.id]),
      (error: unknown) => error instanceof SkillError && error.code === 'SKILLS_NO_SKILLS_SELECTED',
    );
    await assert.rejects(
      manager.install(preview.token, ['demo-skill'], ['claude-code']),
      (error: unknown) => error instanceof SkillError && error.code === 'SKILLS_AGENT_NOT_ALLOWED',
    );
    const result = await manager.install(preview.token, ['demo-skill'], [target.id]);
    assert.equal(result.installed.length, 1);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps the source preview after a strict install rejection', async () => {
  const root = await workspace();
  const bad = path.join(root, 'source', 'bad-skill');
  await mkdir(bad, { recursive: true });
  await writeFile(path.join(bad, 'SKILL.md'), [
    '---',
    'name: bad-skill',
    'description: A skill with a symlink.',
    '---',
  ].join('\n'));
  await symlink('SKILL.md', path.join(bad, 'link.md'));
  const manager = new SkillManager(root);
  try {
    const target = (await manager.targets())[0];
    const preview = await manager.resolve('./source');
    assert.deepEqual(preview.skills.map((skill) => skill.name).sort(), ['bad-skill', 'demo-skill']);
    await assert.rejects(
      manager.install(preview.token, ['bad-skill'], [target.id]),
      (error: unknown) => error instanceof SkillError && error.code === 'SKILLS_SKILL_CONTAINS_SYMLINKS',
    );
    const result = await manager.install(preview.token, ['demo-skill'], [target.id]);
    assert.equal(result.installed.length, 1);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects local sources outside the workspace', async () => {
  const root = await workspace();
  const outside = await mkdtemp(path.join(tmpdir(), 'anther-skills-outside-'));
  const manager = new SkillManager(root);
  try {
    await assert.rejects(
      manager.resolve(path.join(outside, 'source')),
      (error: unknown) => error instanceof SkillError
        && error.code === 'SKILLS_LOCAL_SOURCE_OUTSIDE_WORKSPACE',
    );
    await assert.rejects(
      manager.resolve(`../${path.basename(outside)}`),
      (error: unknown) => error instanceof SkillError
        && error.code === 'SKILLS_LOCAL_SOURCE_OUTSIDE_WORKSPACE',
    );
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('rejects a local source that escapes through a symlink', async () => {
  const root = await workspace();
  const outside = await mkdtemp(path.join(tmpdir(), 'anther-skills-link-'));
  await mkdir(path.join(outside, 'skill'), { recursive: true });
  await writeFile(path.join(outside, 'skill', 'SKILL.md'), [
    '---',
    'name: linked-skill',
    'description: Outside the workspace.',
    '---',
  ].join('\n'));
  const manager = new SkillManager(root);
  try {
    await symlink(path.join(outside, 'skill'), path.join(root, 'linked'));
    await assert.rejects(
      manager.resolve('./linked'),
      (error: unknown) => error instanceof SkillError
        && error.code === 'SKILLS_LOCAL_SOURCE_OUTSIDE_WORKSPACE',
    );
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('disposing a preview makes it unusable', async () => {
  const root = await workspace();
  const manager = new SkillManager(root);
  try {
    const target = (await manager.targets())[0];
    const preview = await manager.resolve('./source');
    assert.equal(await manager.dispose(preview.token), true);
    assert.equal(await manager.dispose(preview.token), false);
    await assert.rejects(
      manager.install(preview.token, ['demo-skill'], [target.id]),
      (error: unknown) => error instanceof SkillError && error.code === 'SKILLS_PREVIEW_EXPIRED',
    );
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});
