// web/src/views/git.tsx
// Git 面板（主区域独立标签，单例）：顶部提交区 + 全选/取消全选，下方改动列表。
// 每行：点行主体 = 切换勾选；行尾独立 [diff] 按钮 = 打开该文件 diff 标签（两目标分离，避免误触）。
import { createSignal, onMount, For, Show } from 'solid-js';
import { api, type GitStatus, type GitChange } from '../api.ts';
import { openGitDiff } from '../stores.ts';
import { t } from '../i18n.ts';

export function togglePath(selected: Set<string>, path: string): Set<string> {
  const next = new Set(selected);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

export function allPaths(status: GitStatus | null): string[] {
  return status?.changes.map((c) => c.path) ?? [];
}

export function selectedPaths(status: GitStatus | null, selected: Set<string>): string[] {
  return allPaths(status).filter((p) => selected.has(p));
}

/** 状态字母 → CSS 着色类名（git-status-<class>） */
export function statusClass(status: string): string {
  if (status === '??') return 'untracked';
  if (status === 'D') return 'deleted';
  if (status === 'A') return 'added';
  if (status === 'R' || status === 'C') return 'renamed';
  return 'modified';
}

export function GitView() {
  const [status, setStatus] = createSignal<GitStatus | null>(null);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [message, setMessage] = createSignal('');
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [committing, setCommitting] = createSignal(false);

  /** 拉 status + 默认全选（每次打开面板挂载即刷新，标签切换即重新挂载） */
  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const s = await api.git.status();
      setStatus(s);
      setSelected(new Set(allPaths(s)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => void refresh());

  async function handleCommit(): Promise<void> {
    const msg = message().trim();
    const paths = selectedPaths(status(), selected());
    if (paths.length === 0 || msg === '') return;
    setCommitting(true); // 提交中态：避免并发 commit（spec §6.2）
    try {
      await api.git.commit(paths, msg);
      setMessage('');
      await refresh();
    } catch (e) {
      setError((e as Error).message); // 展示 git 原始错误（spec §6.1）
    } finally {
      setCommitting(false);
    }
  }

  const canCommit = () =>
    !committing() && !loading() && message().trim() !== '' && selectedPaths(status(), selected()).length > 0;

  return (
    <div class="git-view">
      <div class="git-commit-bar">
        <input
          class="git-message"
          value={message()}
          onInput={(e) => setMessage(e.currentTarget.value)}
          placeholder={t('git.commitPlaceholder')}
        />
        <button class="icon-btn git-commit-btn" disabled={!canCommit()} onClick={() => void handleCommit()}>
          {committing() ? t('loading') : t('git.commit')}
        </button>
      </div>
      <div class="git-select-row">
        <button class="link-btn" disabled={loading()} onClick={() => setSelected(new Set(allPaths(status())))}>
          {t('git.selectAll')}
        </button>
        <button class="link-btn" disabled={loading()} onClick={() => setSelected(new Set())}>
          {t('git.clearAll')}
        </button>
      </div>
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <Show when={!loading() && status()?.isRepo === false}>
        <div class="view-placeholder">{t('git.notRepo')}</div>
      </Show>
      <Show when={!loading() && status()?.isRepo && allPaths(status()).length === 0}>
        <div class="view-placeholder">{t('git.empty')}</div>
      </Show>
      <Show when={loading()}>
        <div class="view-placeholder">{t('loading')}</div>
      </Show>
      <ul class="git-list">
        <For each={status()?.changes ?? []}>
          {(c: GitChange) => (
            <li class="git-row">
              <button
                class={`git-row-main ${selected().has(c.path) ? 'checked' : ''}`}
                onClick={() => setSelected((prev) => togglePath(prev, c.path))}
              >
                <span class="git-check">{selected().has(c.path) ? '☑' : '☐'}</span>
                <span class="git-path">{c.path}</span>
                <span class={`git-status git-status-${statusClass(c.status)}`}>{c.status}</span>
              </button>
              <button class="icon-btn git-diff-btn" onClick={() => void openGitDiff(c.path)} title={t('git.viewDiff')}>
                ↔
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
