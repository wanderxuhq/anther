// server/shell.ts
// 交互式 shell 选择。Unix 仍使用 bash（由 pty.ts 的 script/stty 实现）；
// Windows 使用 PowerShell 7 → Windows PowerShell → cmd 的自动检测顺序。
// 客户端只能传枚举值，绝不接受任意可执行文件路径。
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type ShellKind = 'bash' | 'pwsh' | 'powershell' | 'cmd';

export const SHELL_KINDS: readonly ShellKind[] = ['bash', 'pwsh', 'powershell', 'cmd'];

export function isShellKind(value: unknown): value is ShellKind {
  return typeof value === 'string' && (SHELL_KINDS as readonly string[]).includes(value);
}

/** 用户配置的默认 shell；未配置或非法值都回退到 auto。 */
export function configuredShell(env: NodeJS.ProcessEnv = process.env): ShellKind | 'auto' {
  const value = (env.ANTHER_SHELL ?? '').trim().toLowerCase();
  return isShellKind(value) ? value : 'auto';
}

export type ShellSpec = {
  kind: ShellKind;
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export type ShellOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  hostname?: string;
  /** 可执行文件存在性探测；测试可注入，避免依赖真实 Windows 环境。 */
  isFile?: (file: string) => Promise<boolean>;
};

// PowerShell 集成脚本（-EncodedCommand 传入，避免 Windows 命令行转义问题）：
// - UTF-8 输出，避免中文乱码；
// - prompt wrapper 通过 OSC 7 上报当前目录（file:// URI），前端据此解析相对路径。
// 不加 -NoProfile：保留用户自己的 profile、别名和环境。
const POWERSHELL_INTEGRATION = [
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '$OutputEncoding = [Console]::OutputEncoding',
  '$global:__anther_prompt = $function:prompt',
  'function global:prompt {',
  "  if ($PWD.Provider.Name -eq 'FileSystem') {",
  '    $uri = ([System.Uri]$PWD.ProviderPath).AbsoluteUri',
  '    [Console]::Write("$([char]27)]7;$uri$([char]7)")',
  '  }',
  '  if ($global:__anther_prompt) { & $global:__anther_prompt } else { "PS> " }',
  '}',
].join('\n');

function baseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'anther',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
}

function envValue(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    // process.env 在 Windows 上大小写不敏感；测试注入的普通对象需要显式兜底。
    const value = env[name];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

function windowsPathEntries(env: NodeJS.ProcessEnv): string[] {
  return (envValue(env, 'Path', 'PATH') ?? '')
    .split(';')
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

async function defaultIsFile(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function powershellArgs(): string[] {
  const encoded = Buffer.from(POWERSHELL_INTEGRATION, 'utf16le').toString('base64');
  return ['-NoLogo', '-NoExit', '-EncodedCommand', encoded];
}

async function windowsShell(
  kind: ShellKind,
  env: NodeJS.ProcessEnv,
  hostname: string,
  isFile: (file: string) => Promise<boolean>,
): Promise<ShellSpec | null> {
  const winJoin = path.win32.join;
  const systemRoot = envValue(env, 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR') ?? 'C:\\Windows';

  if (kind === 'pwsh' || kind === 'powershell') {
    const candidates = kind === 'pwsh'
      ? [
        ...windowsPathEntries(env).map((dir) => winJoin(dir, 'pwsh.exe')),
        ...(envValue(env, 'ProgramFiles', 'PROGRAMFILES')
          ? [
            winJoin(envValue(env, 'ProgramFiles', 'PROGRAMFILES')!, 'PowerShell', '7', 'pwsh.exe'),
            winJoin(envValue(env, 'ProgramFiles', 'PROGRAMFILES')!, 'PowerShell', '7-preview', 'pwsh.exe'),
          ]
          : []),
        ...(envValue(env, 'LOCALAPPDATA')
          ? [winJoin(envValue(env, 'LOCALAPPDATA')!, 'Microsoft', 'WindowsApps', 'pwsh.exe')]
          : []),
      ]
      : [
        winJoin(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ...windowsPathEntries(env).map((dir) => winJoin(dir, 'powershell.exe')),
      ];
    for (const file of candidates) {
      if (await isFile(file)) {
        return { kind, file, args: powershellArgs(), env: baseEnv(env) };
      }
    }
    return null;
  }

  if (kind === 'cmd') {
    const candidates = [
      envValue(env, 'ComSpec', 'COMSPEC'),
      winJoin(systemRoot, 'System32', 'cmd.exe'),
    ].filter((file): file is string => !!file);
    for (const file of candidates) {
      if (await isFile(file)) {
        const shellEnv = baseEnv(env);
        // cmd 没有 prompt hook；用 PROMPT 的 $E 转义做 best-effort OSC 7。
        // 路径未做 URL 编码，遇到空格/百分号可能失效，前端会回退到工作区根目录。
        if (shellEnv.PROMPT === undefined) {
          shellEnv.PROMPT = `$E]7;file://${hostname}/$P$E\\`;
        }
        return { kind, file, args: ['/d', '/k', 'chcp 65001>nul'], env: shellEnv };
      }
    }
    return null;
  }

  return null;
}

/**
 * 解析要启动的 shell。
 * - 非 Windows：只支持 bash（与现有 PTY 行为一致）；显式选择其他 shell 会报错。
 * - Windows：auto 依次探测 pwsh → powershell → cmd。
 */
export async function resolveShell(
  requested: string | undefined,
  options: ShellOptions = {},
): Promise<ShellSpec> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const hostname = options.hostname ?? os.hostname();
  const isFile = options.isFile ?? defaultIsFile;
  const kind: ShellKind | 'auto' = isShellKind(requested) ? requested : configuredShell(env);

  if (platform !== 'win32') {
    if (kind !== 'auto' && kind !== 'bash') {
      throw new Error(`${kind} shell is only available on Windows`);
    }
    // 实际 shell 仍由 UnixPtySession 固定为 bash；这里只提供元数据。
    return { kind: 'bash', file: 'bash', args: [], env: baseEnv(env) };
  }

  if (kind === 'bash') {
    throw new Error('bash is not available on Windows; run anther inside WSL instead');
  }

  const order: ShellKind[] = kind === 'auto' ? ['pwsh', 'powershell', 'cmd'] : [kind];
  for (const candidate of order) {
    const spec = await windowsShell(candidate, env, hostname, isFile);
    if (spec) return spec;
  }
  throw new Error(kind === 'auto'
    ? 'no supported Windows shell found (pwsh, powershell, or cmd)'
    : `${kind} shell not found`);
}

/** 当前平台可选的 shell 列表；Unix 返回空（前端不显示选择器）。 */
export async function availableShells(options: ShellOptions = {}): Promise<ShellKind[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return [];
  const env = options.env ?? process.env;
  const hostname = options.hostname ?? os.hostname();
  const isFile = options.isFile ?? defaultIsFile;
  const result: ShellKind[] = [];
  for (const kind of ['pwsh', 'powershell', 'cmd'] as const) {
    if (await windowsShell(kind, env, hostname, isFile)) result.push(kind);
  }
  return result;
}
