// web/src/system-info-model.ts
// 系统信息展示的纯格式化函数（不依赖 DOM，node:test 可直接导入）。

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 1024 进制；≥100 时不保留小数，避免 "1023.9 GB" 这类噪声。非法值显示 —。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

export function usedBytes(total: number, free: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(free)) return 0;
  return Math.max(0, total - free);
}

/** 1/5/15 分钟负载，固定两位小数；缺项按 0 补齐。 */
export function formatLoad(loadavg: readonly number[]): string {
  const values = loadavg.slice(0, 3);
  while (values.length < 3) values.push(0);
  return values.map((value) => Number.isFinite(value) ? value.toFixed(2) : '—').join(' ');
}

export type DurationLabels = { day: string; hour: string; minute: string; second: string };

/** 人类可读时长：超过一天时省掉分钟，低于一分钟时显示秒。 */
export function formatUptime(seconds: number, labels: DurationLabels): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}${labels.day}`);
  if (hours > 0) parts.push(`${hours}${labels.hour}`);
  if (days === 0 && minutes > 0) parts.push(`${minutes}${labels.minute}`);
  if (days === 0 && hours === 0 && minutes === 0) parts.push(`${secs}${labels.second}`);
  return parts.join(' ');
}
