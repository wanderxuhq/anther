import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentSpawnCommand } from './agent-spawn.ts';

test('spawns native executables directly on every platform', () => {
  assert.deepEqual(agentSpawnCommand('/usr/local/bin/opencode', 'linux'), {
    file: '/usr/local/bin/opencode',
    shell: false,
  });
  assert.deepEqual(agentSpawnCommand('C:\\Program Files\\nodejs\\opencode.exe', 'win32'), {
    file: 'C:\\Program Files\\nodejs\\opencode.exe',
    shell: false,
  });
});

test('runs Windows batch shims through cmd.exe with the executable quoted', () => {
  assert.deepEqual(agentSpawnCommand('C:\\Users\\Foo Bar\\AppData\\Roaming\\npm\\opencode.cmd', 'win32'), {
    file: '"C:\\Users\\Foo Bar\\AppData\\Roaming\\npm\\opencode.cmd"',
    shell: true,
  });
  assert.deepEqual(agentSpawnCommand('C:\\Tools\\command-code.CMD', 'win32'), {
    file: '"C:\\Tools\\command-code.CMD"',
    shell: true,
  });
  assert.deepEqual(agentSpawnCommand('C:\\Tools\\agent.bat', 'win32'), {
    file: '"C:\\Tools\\agent.bat"',
    shell: true,
  });
});

test('keeps batch names inert outside Windows', () => {
  assert.deepEqual(agentSpawnCommand('/usr/local/bin/opencode.cmd', 'linux'), {
    file: '/usr/local/bin/opencode.cmd',
    shell: false,
  });
});
