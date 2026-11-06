// server/system.ts
// 服务器系统信息采集：主机 / 系统 / CPU / 内存 / 磁盘 / 运行时长 / 版本。
// 只读、无缓存（点击时现取）；版本号从安装包 package.json 读取并按进程缓存。
import os from 'node:os';
import path from 'node:path';
import { statfs } from 'node:fs/promises';
import { appVersion } from './app-info.ts';

export type SystemInfo = {
  hostname: string;
  /** os.type()，如 Linux / Darwin / Windows_NT */
  type: string;
  /** os.platform()，如 linux / darwin / win32 */
  platform: string;
  release: string;
  arch: string;
  node: string;
  /** anther 自身版本（package.json），读取失败为 unknown */
  version: string;
  /** 系统运行时长（秒） */
  uptime: number;
  /** 当前 anther 进程运行时长（秒） */
  processUptime: number;
  cpuModel: string;
  cpuCount: number;
  loadavg: number[];
  totalMem: number;
  freeMem: number;
  /** 工作区绝对路径 */
  workspace: string;
  /** 工作区所在文件系统容量；statfs 不可用（如部分平台/权限）时为 null */
  disk: { total: number; free: number } | null;
};

async function readDisk(root: string): Promise<{ total: number; free: number } | null> {
  try {
    const stats = await statfs(root);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    if (!Number.isFinite(total) || total <= 0) return null;
    return { total, free: Number.isFinite(free) ? Math.max(0, free) : 0 };
  } catch {
    return null;
  }
}

export async function collectSystemInfo(workspaceRoot: string): Promise<SystemInfo> {
  const cpus = os.cpus();
  const rawModel = cpus[0]?.model.trim() ?? '';
  return {
    hostname: os.hostname(),
    type: os.type(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version,
    version: await appVersion(),
    uptime: Math.max(0, Math.floor(os.uptime())),
    processUptime: Math.max(0, Math.floor(process.uptime())),
    // 部分容器/虚拟机会把型号报成 "unknown"；availableParallelism 会考虑 cgroup/亲和性。
    cpuModel: rawModel && rawModel.toLowerCase() !== 'unknown' ? rawModel : 'Unknown CPU',
    cpuCount: os.availableParallelism() || cpus.length || 1,
    loadavg: os.loadavg(),
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    workspace: path.resolve(workspaceRoot),
    disk: await readDisk(workspaceRoot),
  };
}
