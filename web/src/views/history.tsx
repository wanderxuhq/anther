// web/src/views/history.tsx
// 历史视图（图）：分支选择器 + 提交图（泳道岔线/合并菱形）+ 分支徽标。
// 图取代扁平列表（spec §5.3）：log 一次拉 1000 条 topo 序 → layoutGraph 逐行渲染。
// 每行整条是点击区 → openGitCommit(hash)；超 1000 截断提示。
import { createEffect, createSignal, Show, For, onCleanup } from 'solid-js';
import { api, type GitBranches, type GitCommit } from '../api.ts';
import { gitRefreshTick, openGitCommit, historyBranch, selectHistoryBranch } from '../stores.ts';
import { commitTimeLabel } from './history-model.ts';
import { layoutGraph, parseDecorations, type GraphRow } from './graph-model.ts';
import { t } from '../i18n.ts';

const LIMIT = 1000;  // 图一次拉全（lane 不可跨页）
const LANE_W = 16;   // 每泳道宽
const ROW_H = 20;    // 每行 SVG 高

export function HistoryView() {
  const [branches, setBranches] = createSignal<GitBranches | null>(null);
  const branch = () => historyBranch() ?? branches()?.current ?? null;
  const [commits, setCommits] = createSignal<GitCommit[]>([]);
  const [rows, setRows] = createSignal<GraphRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  // 分支列表 + 默认选中当前分支（gitRefreshTick 变化 → 刷新）
  createEffect(() => {
    gitRefreshTick();
    void (async () => {
      try {
        const b = await api.git.branches();
        setBranches(b);
      } catch { /* 静默，错误条由 log effect 承担 */ }
    })();
  });

  // 首屏 / 切分支 / 刷新：拉 1000 条 → layoutGraph（cancelled 竞态守卫沿用）
  createEffect(() => {
    const b = branch();
    gitRefreshTick();
    setLoading(true);
    setCommits([]);
    setRows([]);
    let cancelled = false;
    void (async () => {
      try {
        if (branches()?.isRepo === false) {
          setError(null);
          return;
        }
        const res = await api.git.log({ branch: b ?? undefined, limit: LIMIT, skip: 0 });
        if (cancelled) return;
        setCommits(res.commits);
        setRows(layoutGraph(res.commits));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    onCleanup(() => { cancelled = true; });
  });

  return (
    <div class="history-view">
      <div class="history-bar">
        <select
          class="history-select"
          value={branch() ?? ''}
          onInput={(e) => selectHistoryBranch(e.currentTarget.value || null)}
          disabled={!branches()?.isRepo}
        >
          <Show when={branch() && !branches()?.branches.some((b) => b.name === branch())}>
            <option value={branch()!}>{branch()}</option>
          </Show>
          <For each={branches()?.branches ?? []}>
            {(b) => <option value={b.name}>{b.name}</option>}
          </For>
        </select>
      </div>
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <Show when={!loading() && !branches()?.isRepo}>
        <div class="view-placeholder">{t('git.notRepo')}</div>
      </Show>
      <Show when={!loading() && branches()?.isRepo && commits().length === 0}>
        <div class="view-placeholder">{t('git.emptyHistory')}</div>
      </Show>
      <Show when={loading()}>
        <div class="view-placeholder">{t('loading')}</div>
      </Show>
      <Show when={commits().length >= LIMIT}>
        <div class="history-truncated">{t('git.graphTruncated')}</div>
      </Show>
      <ul class="history-list">
        <For each={rows()}>
          {(row, i) => {
            const c = commits()[i()]; // rows 与 commits 并行（layoutGraph 一行一提交）
            const { branches: decs } = parseDecorations(c.decorations);
            const laneCount = Math.max(row.col, ...row.segs.map((s) => Math.max(s.a, s.b))) + 1;
            return (
              <li>
                <button class="history-row" onClick={() => openGitCommit(c.hash)}>
                  <span class="history-graph">
                    <svg width={laneCount * LANE_W} height={ROW_H} class="graph-svg">
                      {row.segs.map((s) => (
                        <line
                          x1={(s.a + 0.5) * LANE_W} y1={0}
                          x2={(s.b + 0.5) * LANE_W} y2={ROW_H}
                          class={`graph-line lane-${s.a % 6}`}
                        />
                      ))}
                      {c.parents.length > 1 ? (
                        // 合并提交：实心菱形 + 双入线
                        <path
                          d={`M ${(row.col + 0.5) * LANE_W} ${ROW_H / 2 - 4}
                              L ${(row.col + 0.5) * LANE_W + 4} ${ROW_H / 2}
                              L ${(row.col + 0.5) * LANE_W} ${ROW_H / 2 + 4}
                              L ${(row.col + 0.5) * LANE_W - 4} ${ROW_H / 2} Z`}
                          class={`graph-dot lane-${row.col % 6}`}
                        />
                      ) : (
                        <circle cx={(row.col + 0.5) * LANE_W} cy={ROW_H / 2} r={3.5} class={`graph-dot lane-${row.col % 6}`} />
                      )}
                    </svg>
                  </span>
                  <span class="history-main">
                    <span class="history-subject">{c.subject}</span>
                    <span class="history-meta">{c.author} · {commitTimeLabel(c)}</span>
                  </span>
                  <span class="history-badges">
                    <For each={decs}>{(d) => <span class="git-branch-badge">{d}</span>}</For>
                  </span>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </div>
  );
}
