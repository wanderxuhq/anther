// server/shell.test.ts
// shell 探测/参数/环境变量的纯逻辑测试：注入 platform 与 isFile，Linux 上也能跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableShells, configuredShell, resolveShell, type ShellOptions } from './shell.ts';

const WIN_ENV: NodeJS.ProcessEnv = {
  Path: 'C:\\Tools;C:\\Windows\\System32',
  SystemRoot: 'C:\\Windows',
  ComSpec: 'C:\\Windows\\system32\\cmd.exe',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
};

function winOptions(files: string[], env: NodeJS.ProcessEnv = WIN_ENV): ShellOptions {
  const existing = new Set(files.map((file) => file.toLowerCase()));
  return {
    platform: 'win32',
    env,
    hostname: 'HOST',
    isFile: async (file) => existing.has(file.toLowerCase()),
  };
}

function decodePowerShell(args: string[]): string {
  const index = args.indexOf('-EncodedCommand');
  assert.ok(index >= 0, '缺少 -EncodedCommand');
  return Buffer.from(args[index + 1], 'base64').toString('utf16le');
}

test('configuredShell：环境变量大小写/非法值', () => {
  assert.equal(configuredShell({}), 'auto');
  assert.equal(configuredShell({ ANTHER_SHELL: 'pwsh' }), 'pwsh');
  assert.equal(configuredShell({ ANTHER_SHELL: 'CMD' }), 'cmd');
  assert.equal(configuredShell({ ANTHER_SHELL: 'nope' }), 'auto');
});

test('非 Windows：保留 bash；显式选择其他 shell 报错', async () => {
  const spec = await resolveShell(undefined, { platform: 'linux', env: {} });
  assert.equal(spec.kind, 'bash');
  assert.equal((await resolveShell('auto', { platform: 'darwin', env: {} })).kind, 'bash');
  await assert.rejects(resolveShell('cmd', { platform: 'linux', env: {} }), /only available on Windows/);
});

test('Windows auto：pwsh → powershell → cmd 顺序', async () => {
  const pwsh = await resolveShell(undefined, winOptions(['C:\\Tools\\pwsh.exe']));
  assert.equal(pwsh.kind, 'pwsh');
  assert.equal(pwsh.file, 'C:\\Tools\\pwsh.exe');
  assert.equal(pwsh.args[0], '-NoLogo');
  assert.equal(pwsh.args[1], '-NoExit');
  const script = decodePowerShell(pwsh.args);
  assert.match(script, /\[Console\]::OutputEncoding/);
  assert.match(script, /\]7;\$uri/);
  assert.equal(pwsh.env.TERM, 'xterm-256color');
  assert.equal(pwsh.env.TERM_PROGRAM, 'anther');
  assert.equal(pwsh.env.PYTHONUTF8, '1');

  const ps = await resolveShell(undefined, winOptions(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']));
  assert.equal(ps.kind, 'powershell');

  const cmd = await resolveShell(undefined, winOptions(['C:\\Windows\\system32\\cmd.exe']));
  assert.equal(cmd.kind, 'cmd');
  assert.deepEqual(cmd.args, ['/d', '/k', 'chcp 65001>nul']);
  assert.match(cmd.env.PROMPT ?? '', /^\$E\]7;file:\/\/HOST\/\$P\$E\\$/);
});

test('Windows：显式 shell 不探测更高优先级；缺失时报错', async () => {
  const options = winOptions(['C:\\Tools\\pwsh.exe', 'C:\\Windows\\system32\\cmd.exe']);
  const cmd = await resolveShell('cmd', options);
  assert.equal(cmd.kind, 'cmd');
  await assert.rejects(resolveShell('powershell', options), /powershell shell not found/);
  await assert.rejects(resolveShell('bash', options), /WSL/);
});

test('Windows：不覆盖用户已有 PROMPT', async () => {
  const env = { ...WIN_ENV, PROMPT: '$P$G' };
  const cmd = await resolveShell('cmd', winOptions(['C:\\Windows\\system32\\cmd.exe'], env));
  assert.equal(cmd.env.PROMPT, '$P$G');
});

test('availableShells：Windows 返回可用项，其他平台为空', async () => {
  assert.deepEqual(
    await availableShells(winOptions(['C:\\Tools\\pwsh.exe', 'C:\\Windows\\system32\\cmd.exe'])),
    ['pwsh', 'cmd'],
  );
  assert.deepEqual(await availableShells({ platform: 'linux', env: {}, isFile: async () => true }), []);
});

test('Windows：ANTHER_SHELL 作为默认值', async () => {
  const env = { ...WIN_ENV, ANTHER_SHELL: 'cmd' };
  const spec = await resolveShell(undefined, winOptions(['C:\\Tools\\pwsh.exe', 'C:\\Windows\\system32\\cmd.exe'], env));
  assert.equal(spec.kind, 'cmd');
});
