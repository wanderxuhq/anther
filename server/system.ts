// server/system.ts
// 服务器系统信息采集：主机 / 系统 / CPU / 内存 / 磁盘 / 运行时长 / 版本。
// 只读、无缓存（点击时现取）；版本号从安装包 package.json 读取并按进程缓存。
import os from 'node:os';
import path from 'node:path';
import { statfs } from 'node:fs/promises';
import { appVersion } from './app-info.ts';

export type SystemAddress = {
  /** 网络接口名，如 eth0 / wlan0 / lo */
  interface: string;
  address: string;
  family: 'IPv4' | 'IPv6';
  /** 回环地址（127.0.0.1 / ::1） */
  internal: boolean;
};

export type SystemInfo = {
  hostname: string;
  /** 所有本机网络地址，非回环地址排在前面 */
  addresses: SystemAddress[];
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

/** 枚举所有网络接口地址；受限环境（无权限/无接口）返回空数组。 */
function readAddresses(): SystemAddress[] {
  let interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  try {
    interfaces = os.networkInterfaces();
  } catch {
    return [];
  }
  const result: SystemAddress[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      const rawFamily = String(info.family);
      const family = rawFamily === 'IPv4' || rawFamily === '4' ? 'IPv4'
        : rawFamily === 'IPv6' || rawFamily === '6' ? 'IPv6' : null;
      if (!family) continue;
      result.push({ interface: name, address: info.address, family, internal: info.internal });
    }
  }
  // 非回环优先，其次 IPv4 优先，再按接口名/地址稳定排序。
  return result.sort((a, b) =>
    Number(a.internal) - Number(b.internal)
    || (a.family === b.family ? 0 : a.family === 'IPv4' ? -1 : 1)
    || a.interface.localeCompare(b.interface)
    || a.address.localeCompare(b.address));
}

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
    addresses: readAddresses(),
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
