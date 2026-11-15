import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  fetchLatestVersion,
  checkForUpdate,
  launchContext,
  packageManager,
  installCommand,
  runUpdate,
  reportUpdateAvailable,
} from './update.ts';

test('compareVersions orders numeric segments, builds, and prereleases', () => {
  assert.equal(compareVersions('0.1.10', '0.1.7'), 1);
  assert.equal(compareVersions('v0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('0.1.7+abc', '0.1.7'), 0);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1);
});

test('fetchLatestVersion reads version and returns null on every failure', async () => {
  const ok = (async () => new Response(JSON.stringify({ version: '0.2.0' }))) as typeof fetch;
  assert.equal(await fetchLatestVersion(ok, 100, 'https://registry.example'), '0.2.0');

  const offline = (async () => { throw new Error('offline'); }) as typeof fetch;
  assert.equal(await fetchLatestVersion(offline, 100), null);

  const notFound = (async () => new Response('no', { status: 404 })) as typeof fetch;
  assert.equal(await fetchLatestVersion(notFound, 100), null);

  const malformed = (async () => new Response(JSON.stringify({ version: 42 }))) as typeof fetch;
  assert.equal(await fetchLatestVersion(malformed, 100), null);
});

test('fetchLatestVersion rejects invalid registry versions', async () => {
  const serve = (version: string) => (async () => new Response(JSON.stringify({ version }))) as typeof fetch;
  for (const version of ['not-a-version', '0.1.7 ', ' 0.1.7', '1.0.0-', '1.0', '1.0.0.0', '01.0.0', '1.0.0-+x']) {
    assert.equal(await fetchLatestVersion(serve(version), 100, 'https://registry.example'), null, version);
  }
  // 预发布 + 构建元数据仍是合法 SemVer
  assert.equal(await fetchLatestVersion(serve('1.0.0-rc.1+build.5'), 100, 'https://registry.example'), '1.0.0-rc.1+build.5');
});

test('checkForUpdate only reports a strictly newer version', async () => {
  const serve = (version: string) => (async () => new Response(JSON.stringify({ version }))) as typeof fetch;
  assert.deepEqual(await checkForUpdate('0.1.7', serve('0.1.8')), { current: '0.1.7', latest: '0.1.8' });
  assert.equal(await checkForUpdate('0.1.8', serve('0.1.8')), null);
  assert.equal(await checkForUpdate('0.1.9', serve('0.1.8')), null);
});

test('checkForUpdate rejects invalid versions on either side', async () => {
  const serve = (version: string) => (async () => new Response(JSON.stringify({ version }))) as typeof fetch;
  assert.equal(await checkForUpdate('not-a-version', serve('0.2.0')), null);
  assert.equal(await checkForUpdate('0.1.7 ', serve('0.2.0')), null);
  assert.equal(await checkForUpdate('0.1.7', serve('not-a-version')), null);
  assert.equal(await checkForUpdate('0.1.7', serve('1.0')), null);
});

test('launchContext distinguishes installed, npx-like, and source paths', () => {
  assert.equal(launchContext('file:///usr/lib/node_modules/@wanderxuhq/anther/dist/server/update.js'), 'installed');
  assert.equal(launchContext('file:///home/u/.npm/_npx/abc/node_modules/@wanderxuhq/anther/dist/server/update.js'), 'npx');
  assert.equal(launchContext('file:///home/u/.cache/pnpm/dlx/abc/node_modules/@wanderxuhq/anther/dist/server/update.js'), 'npx');
  assert.equal(launchContext('file:///home/u/.bun/install/cache/@wanderxuhq/anther@0.1.7/dist/server/update.js'), 'npx');
  assert.equal(launchContext('file:///root/projects/anther/server/update.ts'), 'source');
});

test('packageManager follows the user agent, then the install path', () => {
  assert.equal(packageManager('/usr/lib/node_modules/x', { npm_config_user_agent: 'pnpm/9.0.0 npm/? node/v24' }), 'pnpm');
  assert.equal(packageManager('/usr/lib/node_modules/x', { npm_config_user_agent: 'yarn/4.1.0 npm/? node/v24' }), 'yarn');
  assert.equal(packageManager('/usr/lib/node_modules/x', { npm_config_user_agent: 'bun/1.1.0' }), 'bun');
  assert.equal(packageManager('/usr/lib/node_modules/x', {}), 'npm');
  assert.equal(packageManager('/home/u/.local/share/pnpm/global/5/node_modules/x', {}), 'pnpm');
  assert.equal(packageManager('/home/u/app/node_modules/.pnpm/@wanderxuhq+anther@0.1.7/node_modules/@wanderxuhq/anther/dist/server/update.js', {}), 'pnpm');
  assert.equal(packageManager('/home/u/.bun/install/global/node_modules/x', {}), 'bun');
});

test('installCommand pins the latest version for each manager', () => {
  assert.deepEqual(installCommand('npm', '0.2.0'), { command: 'npm', args: ['install', '-g', '@wanderxuhq/anther@0.2.0'] });
  assert.deepEqual(installCommand('pnpm', '0.2.0'), { command: 'pnpm', args: ['add', '-g', '@wanderxuhq/anther@0.2.0'] });
  assert.deepEqual(installCommand('yarn', '0.2.0'), { command: 'yarn', args: ['global', 'add', '@wanderxuhq/anther@0.2.0'] });
  assert.deepEqual(installCommand('bun', '0.2.0'), { command: 'bun', args: ['add', '-g', '@wanderxuhq/anther@0.2.0'] });
});

const installed = 'file:///usr/lib/node_modules/@wanderxuhq/anther/dist/server/update.js';
const source = 'file:///root/projects/anther/server/update.ts';
const npxPath = 'file:///home/u/.npm/_npx/abc/node_modules/@wanderxuhq/anther/dist/server/update.js';

test('runUpdate never installs from npx or source checkouts', async () => {
  const logs: string[] = [];
  const failingFetch = (async () => { throw new Error('must not fetch'); }) as typeof fetch;
  assert.equal(await runUpdate({ moduleUrl: source, log: (m) => logs.push(m), fetch: failingFetch }), 0);
  assert.match(logs.join('\n'), /source checkout/);
  logs.length = 0;
  assert.equal(await runUpdate({ moduleUrl: npxPath, log: (m) => logs.push(m), fetch: failingFetch }), 0);
  assert.match(logs.join('\n'), /npx @wanderxuhq\/anther@latest/);
});

test('runUpdate reports up-to-date, installs a newer version, and fails cleanly', async () => {
  const latest = (version: string) => (async () => new Response(JSON.stringify({ version }))) as typeof fetch;

  let logs: string[] = [];
  assert.equal(await runUpdate({ moduleUrl: installed, env: {}, version: async () => '0.1.7', fetch: latest('0.1.7'), log: (m) => logs.push(m) }), 0);
  assert.match(logs.join('\n'), /up to date \(0\.1\.7\)/);

  logs = [];
  const calls: string[] = [];
  const result = await runUpdate({
    moduleUrl: installed,
    env: {},
    version: async () => '0.1.7',
    fetch: latest('0.1.8'),
    spawn: async (command, args) => { calls.push([command, ...args].join(' ')); return 0; },
    log: (m) => logs.push(m),
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, ['npm install -g @wanderxuhq/anther@0.1.8']);
  assert.match(logs.join('\n'), /Updated to 0\.1\.8/);

  logs = [];
  assert.equal(await runUpdate({ moduleUrl: installed, env: {}, version: async () => '0.1.7', fetch: (async () => { throw new Error('offline'); }) as typeof fetch, log: (m) => logs.push(m) }), 1);
  assert.match(logs.join('\n'), /Cannot check for updates/);

  logs = [];
  assert.equal(await runUpdate({
    moduleUrl: installed,
    env: {},
    version: async () => '0.1.7',
    fetch: latest('0.1.8'),
    spawn: async () => 1,
    log: (m) => logs.push(m),
  }), 1);
  assert.match(logs.join('\n'), /npm install -g @wanderxuhq\/anther@0\.1\.8/);
});

test('runUpdate treats an unparsable current version as unknown and installs latest', async () => {
  const logs: string[] = [];
  const calls: string[] = [];
  const result = await runUpdate({
    moduleUrl: installed,
    env: {},
    version: async () => '1.0',
    fetch: (async () => new Response(JSON.stringify({ version: '0.1.8' }))) as typeof fetch,
    spawn: async (command, args) => { calls.push([command, ...args].join(' ')); return 0; },
    log: (m) => logs.push(m),
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, ['npm install -g @wanderxuhq/anther@0.1.8']);
  assert.match(logs.join('\n'), /Current version is unknown/);
  assert.match(logs.join('\n'), /Updated to 0\.1\.8/);
});

test('runUpdate does not retry when the install fails for a non-ENOENT reason', async () => {
  const commands: string[] = [];
  const logs: string[] = [];
  const result = await runUpdate({
    moduleUrl: installed,
    env: {},
    version: async () => '0.1.7',
    fetch: (async () => new Response(JSON.stringify({ version: '0.1.8' }))) as typeof fetch,
    spawn: async (command) => { commands.push(command); return -2; },
    log: (m) => logs.push(m),
  });
  assert.equal(result, 1);
  assert.deepEqual(commands, ['npm']);
  assert.match(logs.join('\n'), /Update failed/);
  assert.match(logs.join('\n'), /npm install -g @wanderxuhq\/anther@0\.1\.8/);
});

test('runUpdate falls back to the next manager when the binary is missing', async () => {
  const commands: string[] = [];
  const codes = [-1, 0];
  const result = await runUpdate({
    moduleUrl: installed,
    env: {},
    version: async () => '0.1.7',
    fetch: (async () => new Response(JSON.stringify({ version: '0.1.8' }))) as typeof fetch,
    spawn: async (command) => { commands.push(command); return codes.shift() ?? 1; },
    log: () => {},
  });
  assert.equal(result, 0);
  assert.deepEqual(commands, ['npm', 'pnpm']);
});

test('reportUpdateAvailable is silent on failures and when disabled', async () => {
  const logs: string[] = [];
  const offline = (async () => { throw new Error('offline'); }) as typeof fetch;
  await reportUpdateAvailable({ moduleUrl: installed, version: async () => '0.1.7', fetch: offline, log: (m) => logs.push(m) });
  assert.deepEqual<string[]>(logs, []);

  let fetched = false;
  const fake = (async () => { fetched = true; return new Response('{}'); }) as typeof fetch;
  await reportUpdateAvailable({ moduleUrl: installed, env: { ANTHER_NO_UPDATE_CHECK: '1' }, fetch: fake, log: (m) => logs.push(m) });
  assert.equal(fetched, false);
  assert.deepEqual(logs, []);
});

test('reportUpdateAvailable ignores an invalid current version', async () => {
  const logs: string[] = [];
  let fetched = false;
  const fake = (async () => { fetched = true; return new Response(JSON.stringify({ version: '0.2.0' })); }) as typeof fetch;
  await reportUpdateAvailable({ moduleUrl: installed, env: {}, version: async () => '1.0', fetch: fake, log: (m) => logs.push(m) });
  assert.equal(fetched, false);
  assert.deepEqual<string[]>(logs, []);
});

test('reportUpdateAvailable prints the version pair and the matching hint', async () => {
  const logs: string[] = [];
  const newer = (async () => new Response(JSON.stringify({ version: '0.2.0' }))) as typeof fetch;
  await reportUpdateAvailable({ moduleUrl: installed, version: async () => '0.1.7', fetch: newer, log: (m) => logs.push(m) });
  assert.deepEqual(logs, [
    'Update available: 0.1.7 -> 0.2.0',
    'Run "anther --update" to update.',
  ]);
});
