// server/app-info.ts
// 应用身份与版本：供 /api/anther 与系统信息复用。
// 版本号从安装包 package.json 读取（源码与编译产物到 package.json 的层级不同）。
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';

export const APP_NAME = 'anther';
export const PACKAGE_NAME = '@wanderxuhq/anther';
/** 对外 API 的兼容版本；不兼容变更时才递增。 */
export const API_VERSION = 1;

const VERSION_CANDIDATES = ['../package.json', '../../package.json'];
let versionPromise: Promise<string> | null = null;

async function readVersion(): Promise<string> {
  for (const relative of VERSION_CANDIDATES) {
    try {
      const raw = await readFile(new URL(relative, import.meta.url), 'utf8');
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof version === 'string' && version !== '') return version;
    } catch { /* 尝试下一个层级 */ }
  }
  return 'unknown';
}

/** 当前 anther 版本；读取失败为 "unknown"，进程内缓存。 */
export function appVersion(): Promise<string> {
  versionPromise ??= readVersion();
  return versionPromise;
}

/** 进程级唯一 ID 与启动时间：同一进程内稳定，供启动器区别/记录实例。 */
const INSTANCE_ID = randomUUID();
const STARTED_AT = Date.now() - Math.round(process.uptime() * 1000);

export type AppIdentity = {
  name: string;
  package: string;
  version: string;
  apiVersion: number;
  /** 实例工作区真实绝对路径：启动器判断「端口占用的 anther 是否服务同一目录」 */
  workspace: string;
  /** 进程级唯一 ID */
  instanceId: string;
  /** 进程启动时间（epoch ms） */
  startedAt: number;
};

/** 工作区真实路径：符号链接/相对路径统一，启动器比较时不会误判不同实例。 */
async function canonicalWorkspace(workspaceRoot: string): Promise<string> {
  try {
    return await realpath(workspaceRoot);
  } catch {
    return path.resolve(workspaceRoot);
  }
}

/**
 * GET /api/anther 的响应体：身份 + 实例上下文。
 * 不含主机名/硬件等系统细节（那些只在 /api/system 中按需返回）。
 */
export async function appIdentity(workspaceRoot: string): Promise<AppIdentity> {
  return {
    name: APP_NAME,
    package: PACKAGE_NAME,
    version: await appVersion(),
    apiVersion: API_VERSION,
    workspace: await canonicalWorkspace(workspaceRoot),
    instanceId: INSTANCE_ID,
    startedAt: STARTED_AT,
  };
}
