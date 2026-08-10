// web/src/views/graph-model.ts
// 历史图纯函数：lane-tracing 布局 + %D 徽标解析。独立 .ts 模块 → node --test 直接导入可测。
// 渲染端按 col % 6 上色；徽标只保留分支名（tag 暂不做徽标，用户选定）。
import type { GitCommit } from '../api.ts';

/** 线段：行顶泳道 a → 行底泳道 b（a===b 竖线；否则斜线）。 */
export type GraphSeg = { a: number; b: number };
/** 一行：提交点所在泳道 col + 贯穿本行的线段。 */
export type GraphRow = { col: number; segs: GraphSeg[] };

/**
 * 按 topo 序（子先父后）提交列表 → 每行布局。lane-tracing：
 * - 每提交沿第一父延续泳道（本列线头 → 第一父）
 * - 合并提交的其余父 → 开新列
 * - 多个泳道线头指向同一提交 → 收拢（斜线汇入该提交所在列，后续父线结束）
 */
export function layoutGraph(commits: GitCommit[]): GraphRow[] {
  const rows: GraphRow[] = [];
  const cols: (string | null)[] = []; // cols[i] = 列 i 线头所指提交；null = 空闲
  const free: number[] = [];

  const alloc = (head: string): number => {
    const i = free.pop();
    if (i !== undefined) { cols[i] = head; return i; }
    cols.push(head);
    return cols.length - 1;
  };

  for (const c of commits) {
    let col = -1;
    for (let i = 0; i < cols.length; i++) if (cols[i] === c.hash) { col = i; break; }
    if (col === -1) col = alloc(c.hash);

    const segs: GraphSeg[] = [];
    for (let i = 0; i < cols.length; i++) {
      if (i === col || cols[i] === null) continue;
      if (cols[i] === c.hash) { // 收拢：该列线头是本提交 → 斜线汇入并结束该列
        segs.push({ a: i, b: col });
        cols[i] = null;
        free.push(i);
      } else { // 其他活跃列：竖线贯穿
        segs.push({ a: i, b: i });
      }
    }
    if (c.parents.length > 0) segs.push({ a: col, b: col }); // 本列向下延续

    cols[col] = c.parents[0] ?? null; // 本列 → 第一父
    if (cols[col] === null) free.push(col);
    for (let p = 1; p < c.parents.length; p++) {
      const ph = c.parents[p];
      let target = -1;
      for (let i = 0; i < cols.length; i++) if (cols[i] === ph) { target = i; break; }
      if (target === -1) target = alloc(ph);
      if (target !== col) segs.push({ a: col, b: target }); // 本行补斜线：本列 → 新父列
    }

    rows.push({ col, segs });
  }
  return rows;
}

/** %D 装饰拆解：去 HEAD 指针；分支名保留（tag 单独解析，界面暂不做徽标）。 */
export function parseDecorations(dec: string): { branches: string[]; tags: string[] } {
  const branches: string[] = [];
  const tags: string[] = [];
  if (!dec) return { branches, tags };
  for (const raw of dec.split(',')) {
    const part = raw.trim();
    if (!part || part === 'HEAD') continue;
    if (part.startsWith('HEAD -> ')) { branches.push(part.slice('HEAD -> '.length)); continue; }
    if (part.startsWith('tag: ')) { tags.push(part.slice('tag: '.length)); continue; }
    branches.push(part);
  }
  return { branches, tags };
}
