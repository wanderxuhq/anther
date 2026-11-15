// server/update.ts
// npm 注册表版本检查与自更新：启动时提示新版本，`--update` 时调用包管理器全局安装。
// 模块只输出英文（CLI 面向国际用户，不走前端 i18n）；网络/子进程失败一律降级不崩溃。
import { spawn as spawnProcess } from 'node:child_process';
import { appVersion, PACKAGE_NAME } from './app-info.ts';

/** 当前进程的启动方式：全局安装、包管理器临时执行（npx/pnpm dlx/bunx）、源码目录。 */
export type LaunchContext = 'installed' | 'npx' | 'source';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type UpdateInfo = { current: string; latest: string };

export type RunUpdateDeps = {
  version?: () => Promise<string>;
  fetch?: typeof fetch;
  moduleUrl?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: (command: string, args: string[]) => Promise<number>;
  log?: (message: string) => void;
};

/** 启动检查不需要安装子进程。 */
export type UpdateNoticeDeps = Omit<RunUpdateDeps, 'spawn'>;

const MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_TIMEOUT_MS = 3000;
/** 命令不存在 → 可换下一个包管理器；其余 spawn 失败/信号终止不可重试。 */
const SPAWN_ENOENT = -1;
const SPAWN_FAILED = -2;

/** 严格 SemVer：三段数字 + 可选预发布（标识符非空）/构建元数据，不接受首尾空白。 */
const SEMVER_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** registry 与当前版本必须先通过严格校验，避免脏数据进入比较或安装命令。 */
function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_RE.test(value);
}

/** semver 子集：`v` 前缀、`+build` 元数据与 `-prerelease` 后缀；无法解析返回 null。 */
function parseVersion(raw: string): { core: number[]; pre: string[] } | null {
  const text = raw.trim().replace(/^v/i, '');
  const plus = text.indexOf('+');
  const main = plus === -1 ? text : text.slice(0, plus); // 构建元数据不参与比较
  const dash = main.indexOf('-');
  const coreText = dash === -1 ? main : main.slice(0, dash);
  const preText = dash === -1 ? '' : main.slice(dash + 1);
  const segments = coreText.split('.');
  if (coreText === '' || !segments.every((s) => /^\d+$/.test(s))) return null;
  return { core: segments.map(Number), pre: preText === '' ? [] : preText.split('.') };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // 正式版排在预发布版之后
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1; // 前缀更短者更低
    if (right === undefined) return 1;
    const leftNum = /^\d+$/.test(left);
    const rightNum = /^\d+$/.test(right);
    if (leftNum && rightNum) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    } else if (leftNum !== rightNum) {
      return leftNum ? -1 : 1; // 数字标识符排在非数字之前
    } else if (left !== right) {
      return left > right ? 1 : -1;
    }
  }
  return 0;
}

/** 比较两个版本；无法解析时退化为字符串比较，保证排序结果始终可用。 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return a < b ? -1 : a > b ? 1 : 0;
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return comparePrerelease(left.pre, right.pre);
}

/** 注册表地址：显式环境变量优先，其次 npm 配置，最后官方默认值。 */
export function registryBase(env: NodeJS.ProcessEnv = process.env): string {
  for (const candidate of [env.ANTHER_UPDATE_REGISTRY, env.npm_config_registry]) {
    const value = candidate?.trim();
    if (value) return value.replace(/\/+$/, '');
  }
  return DEFAULT_REGISTRY;
}

/** 读取 registry 上的 latest 版本；任何失败都返回 null（启动检查不能抛错）。 */
export async function fetchLatestVersion(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  registry: string = registryBase(),
): Promise<string | null> {
  try {
    const url = `${registry}/${PACKAGE_NAME.replace('/', '%2F')}/latest`;
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = await response.json() as { version?: unknown };
    return isValidVersion(body?.version) ? body.version : null;
  } catch {
    return null;
  }
}

/** 仅当两侧版本都合法且 registry 上存在严格更新的版本时返回版本对。 */
export async function checkForUpdate(
  current: string,
  fetchImpl: typeof fetch = fetch,
  registry?: string,
): Promise<UpdateInfo | null> {
  if (!isValidVersion(current)) return null;
  const latest = await fetchLatestVersion(fetchImpl, DEFAULT_TIMEOUT_MS, registry);
  if (!latest || compareVersions(latest, current) <= 0) return null;
  return { current, latest };
}

/** 根据模块 URL 判断启动方式：npx/dlx/bunx 的临时目录优先于 node_modules。 */
export function launchContext(moduleUrl: string): LaunchContext {
  const url = moduleUrl.toLowerCase();
  if (
    url.includes('/_npx/')
    || url.includes('/dlx/')
    || url.includes('/bunx/')
    || url.includes('/.bun/install/cache/')
  ) {
    return 'npx';
  }
  if (url.includes('/node_modules/')) return 'installed';
  return 'source';
}

/** 每种启动方式对应的升级提示。 */
export function updateHint(moduleUrl: string): string {
  switch (launchContext(moduleUrl)) {
    case 'installed':
      return 'Run "anther --update" to update.';
    case 'npx':
      return 'Run "npx @wanderxuhq/anther@latest" to use the new version.';
    default:
      return 'Update the source checkout with "git pull" and reinstall dependencies.';
  }
}

/** 包管理器：用户代理（谁启动了当前进程）优先，其次安装路径。 */
export function packageManager(moduleUrl: string, env: NodeJS.ProcessEnv = process.env): PackageManager {
  const agent = (env.npm_config_user_agent ?? '').trim().toLowerCase();
  if (agent.startsWith('pnpm/')) return 'pnpm';
  if (agent.startsWith('yarn/')) return 'yarn';
  if (agent.startsWith('bun/')) return 'bun';
  const path = moduleUrl.toLowerCase();
  if (path.includes('/.pnpm/') || path.includes('/pnpm/')) return 'pnpm';
  if (path.includes('/yarn/')) return 'yarn';
  if (path.includes('/.bun/')) return 'bun';
  return 'npm';
}

/** 各包管理器的全局安装命令；版本固定，避免安装到别的版本。 */
export function installCommand(manager: PackageManager, version: string): { command: string; args: string[] } {
  const target = `${PACKAGE_NAME}@${version}`;
  switch (manager) {
    case 'pnpm':
      return { command: 'pnpm', args: ['add', '-g', target] };
    case 'yarn':
      return { command: 'yarn', args: ['global', 'add', target] };
    case 'bun':
      return { command: 'bun', args: ['add', '-g', target] };
    default:
      return { command: 'npm', args: ['install', '-g', target] };
  }
}

/** 供日志展示的命令行。 */
export function formatCommand(cmd: { command: string; args: string[] }): string {
  return [cmd.command, ...cmd.args].join(' ');
}

/** 默认执行器：继承 stdio，让包管理器的进度直接显示在终端。 */
function defaultSpawn(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawnProcess(command, args, { stdio: 'inherit' });
    // 只有命令不存在才值得换包管理器；权限等错误与信号终止直接失败
    child.once('error', (error) => resolve((error as NodeJS.ErrnoException).code === 'ENOENT' ? SPAWN_ENOENT : SPAWN_FAILED));
    child.once('close', (code) => resolve(code ?? SPAWN_FAILED));
  });
}

/**
 * `--update` 主流程：源码/npx 只给提示（不接管用户的包管理器），
 * 全局安装时先查最新版，再用首选包管理器安装；命令不存在时按顺序尝试其余管理器。
 */
export async function runUpdate(deps: RunUpdateDeps = {}): Promise<number> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const moduleUrl = deps.moduleUrl ?? import.meta.url;
  const context = launchContext(moduleUrl);

  if (context !== 'installed') {
    log(updateHint(moduleUrl));
    return 0;
  }

  const fetchImpl = deps.fetch ?? fetch;
  const env = deps.env ?? process.env;
  const registry = registryBase(env);
  const current = await (deps.version ?? appVersion)();
  const run = deps.spawn ?? defaultSpawn;

  log('Checking for updates...');
  const latest = await fetchLatestVersion(fetchImpl, DEFAULT_TIMEOUT_MS, registry);
  if (!latest) {
    log('Cannot check for updates. Check your network connection and try again.');
    return 1;
  }
  if (isValidVersion(current)) {
    if (compareVersions(latest, current) <= 0) {
      log(`anther is up to date (${current}).`);
      return 0;
    }
    log(`New version available: ${current} -> ${latest}`);
  } else {
    // 当前版本无法解析：不参与比较，直接安装已校验的 latest
    log(`Current version is unknown; installing ${latest}.`);
  }

  const preferred = packageManager(moduleUrl, env);
  const order = [preferred, ...MANAGERS.filter((manager) => manager !== preferred)];
  let failed: { command: string; args: string[] } | null = null;
  for (const manager of order) {
    const cmd = installCommand(manager, latest);
    log(`Updating with: ${formatCommand(cmd)}`);
    const code = await run(cmd.command, cmd.args);
    if (code === 0) {
      log(`Updated to ${latest}. Restart anther to use it.`);
      return 0;
    }
    failed = cmd;
    // 只有命令不存在（-1）才尝试下一个包管理器；真实安装失败直接报错
    if (code !== SPAWN_ENOENT) break;
  }

  log('Update failed.');
  if (failed) log(`You can update manually with: ${formatCommand(failed)}`);
  return 1;
}

/**
 * 启动时的静默检查：默认开启，`ANTHER_NO_UPDATE_CHECK=1` 关闭；
 * 任何异常都被吞掉，绝不影响服务启动。
 */
export async function reportUpdateAvailable(deps: UpdateNoticeDeps = {}): Promise<void> {
  try {
    const env = deps.env ?? process.env;
    if (env.ANTHER_NO_UPDATE_CHECK === '1') return;
    const current = await (deps.version ?? appVersion)();
    if (!isValidVersion(current)) return;
    const moduleUrl = deps.moduleUrl ?? import.meta.url;
    const update = await checkForUpdate(current, deps.fetch ?? fetch, registryBase(env));
    if (!update) return;
    const log = deps.log ?? ((message: string) => console.log(message));
    log(`Update available: ${update.current} -> ${update.latest}`);
    log(updateHint(moduleUrl));
  } catch { /* 启动检查失败必须静默 */ }
}
