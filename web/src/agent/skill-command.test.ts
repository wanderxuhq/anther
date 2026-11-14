import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillCommands, skillMention, skillSlashInput } from './skill-command.ts';
import type { InstalledSkill } from './api.ts';

const skills: InstalledSkill[] = [
  { name: 'pdf-tools', description: 'Extract and edit PDFs', scope: 'project', path: '.agents/skills/pdf-tools', agents: ['opencode'] },
  { name: 'review', description: '  ', scope: 'project', path: '.agents/skills/review', agents: ['opencode'] },
];

test('renders installed skills as slash commands', () => {
  assert.deepEqual(skillCommands(skills, 'Use this skill'), [
    { name: 'skill:pdf-tools', description: 'Extract and edit PDFs', skill: 'pdf-tools' },
    { name: 'skill:review', description: 'Use this skill', skill: 'review' },
  ]);
});

test('parses skill slash input with and without a task', () => {
  assert.deepEqual(skillSlashInput('/skill:pdf-tools', skills), { name: 'pdf-tools', task: '' });
  assert.deepEqual(skillSlashInput('/skill:pdf-tools extract report.pdf', skills), {
    name: 'pdf-tools',
    task: 'extract report.pdf',
  });
  assert.equal(skillSlashInput('/skill:missing', skills), null);
  assert.equal(skillSlashInput('/mcp', skills), null);
});

test('builds skill mentions with an optional task', () => {
  assert.equal(skillMention('pdf-tools'), '@pdf-tools ');
  assert.equal(skillMention('pdf-tools', 'extract report.pdf'), '@pdf-tools extract report.pdf');
});
