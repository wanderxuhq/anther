// web/src/views/history-model.ts
// 历史视图的纯函数 + 共享文案：相对时间分桶 / 日志查询参数。独立 .ts 模块 → node --test 直接导入可测。
import { t } from '../i18n.ts';

export type CommitTime = { kind: 'justNow' | 'minute' | 'hour' | 'day' | 'date'; n: number };

/** 相对时间分桶：<1min 刚刚 / <1h 分钟 / <24h 小时 / <7d 天 / 更早 → 日期。now 显式入参保证可测。 */
export function formatCommitTime(ts: number, now: number): CommitTime {
  const diff = now - ts;
  if (diff < 60_000) return { kind: 'justNow', n: 0 };
  if (diff < 3_600_000) return { kind: 'minute', n: Math.floor(diff / 60_000) };
  if (diff < 86_400_000) return { kind: 'hour', n: Math.floor(diff / 3_600_000) };
  if (diff < 7 * 86_400_000) return { kind: 'day', n: Math.floor(diff / 86_400_000) };
  return { kind: 'date', n: 0 };
}

/** 本地化相对时间文案（历史/提交视图共用）；date 桶直接按浏览器区域格式化日期。 */
export function commitTimeLabel(c: { time: number }): string {
  const { kind, n } = formatCommitTime(c.time, Date.now());
  if (kind === 'justNow') return t('git.time.justNow');
  if (kind === 'minute') return t('git.time.minute', { n });
  if (kind === 'hour') return t('git.time.hour', { n });
  if (kind === 'day') return t('git.time.day', { n });
  return new Date(c.time).toLocaleDateString();
}

/** 日志查询参数：branch 缺省(null)=当前分支（不传）；limit 钳制 [1,100] 缺省 50；skip ≥ 0。防御性钳制，服务端仍白名单校验。 */
export function logParams(
  branch: string | null,
  limit: number,
  skip: number,
): { branch?: string; limit: number; skip: number } {
  const l = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 50;
  const s = Number.isFinite(skip) ? Math.max(Math.trunc(skip), 0) : 0;
  return branch ? { branch, limit: l, skip: s } : { limit: l, skip: s };
}
