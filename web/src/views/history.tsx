// web/src/views/history.tsx
// 历史日志视图：顶部分支选择器（仅切换"看哪条分支的历史"，不切换工作分支）+ 提交列表 + 加载更多。
// 点一行 → openGitCommit(shortHash) 打开该次提交的 diff 标签。
import { createEffect, createSignal, Show, For, onCleanup } from 'solid-js';
import { api, type GitBranches, type GitCommit } from '../api.ts';
import { gitRefreshTick, openGitCommit } from '../stores.ts';
import { commitTimeLabel, logParams } from './history-model.ts';
import { t } from '../i18n.ts';

const LIMIT = 50;

export function HistoryView() {
  const [branches, setBranches] = createSignal<GitBranches | null>(null);
  const [branch, setBranch] = createSignal<string | null>(null); // null = 当前分支
  const [commits, setCommits] = createSignal<GitCommit[]>([]);
  const [skip, setSkip] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // 分支选择器数据：挂载 + gitRefreshTick（checkout/新建分支后刷新；默认跟随当前分支）
  createEffect(() => {
    gitRefreshTick();
    void (async () => {
      try {
        const b = await api.git.branches();
        setBranches(b);
        if (b.current && !b.branches.some((x) => x.name === branch())) setBranch(b.current);
      } catch { /* 静默：非仓库/失败 → 空态 */ }
    })();
  });

  // 首屏 / 切分支 / 刷新：重拉第一页（cancelled 竞态守卫，同 git-diff 模板）
  createEffect(() => {
    const b = branch();
    gitRefreshTick();
    setLoading(true);
    setCommits([]); // 换分支时先清旧列表，避免显示错分支内容
    let cancelled = false;
    void (async () => {
      try {
        // 非仓库：跳过 log 请求（服务端也返回 isRepo:false，此处纵深防御 + 省一次请求）
        if (branches()?.isRepo === false) {
          setCommits([]);
          setSkip(0);
          setError(null);
          return;
        }
        const res = await api.git.log(logParams(b, LIMIT, 0));
        if (cancelled) return;
        setCommits(res.commits);
        setSkip(LIMIT);
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

  async function loadMore(): Promise<void> {
    if (loadingMore()) return;
    const b = branch(); // 捕获发起时的分支：中途切分支 → 旧分页丢弃（防跨分支追加 + skip 错位）
    setLoadingMore(true);
    try {
      const res = await api.git.log(logParams(b, LIMIT, skip()));
      if (branch() !== b) return; // 已切分支，丢弃旧响应
      setCommits((prev) => [...prev, ...res.commits]);
      setSkip((s) => s + LIMIT);
    } catch (e) {
      if (branch() !== b) return; // 旧分支的失败不在新分支上弹错
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div class="history-view">
      <div class="history-bar">
        <select
          class="history-select"
          value={branch() ?? ''}
          onInput={(e) => setBranch(e.currentTarget.value || null)}
          disabled={!branches()?.isRepo}
        >
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
      <ul class="history-list">
        <For each={commits()}>
          {(c) => (
            <li>
              <button class="history-row" onClick={() => openGitCommit(c.shortHash)}>
                <span class="history-subject">{c.subject}</span>
                <span class="history-meta">
                  {c.author} · {commitTimeLabel(c)}
                  {c.decorations ? <span class="history-decoration">{c.decorations}</span> : null}
                </span>
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={commits().length > 0}>
        <div class="history-more">
          <button class="link-btn" disabled={loadingMore()} onClick={() => void loadMore()}>
            {loadingMore() ? t('loading') : t('git.loadMore')}
          </button>
        </div>
      </Show>
    </div>
  );
}
