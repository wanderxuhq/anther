// web/src/views/git.tsx
// Git 面板（主区域独立标签，单例）：同步栏（fetch/pull/push + ahead/behind）、
// 提交区（含 amend）、已暂存/工作区分组。行主体打开 diff，行尾是暂存切换与丢弃。
import { createEffect, createSignal, For, Show, onCleanup } from 'solid-js';
import { api, type GitChange, type GitStatus } from '../api.ts';
import { openGitDiff, gitRefreshTick } from '../stores.ts';
import { t } from '../i18n.ts';
import { Icon } from '../components/icons.tsx';
import { canCommit, changeBadge, stagedChanges, statusClass, unstagedChanges } from './git-model.ts';

type SyncAction = 'fetch' | 'pull' | 'push';
type BusyAction = SyncAction | 'stage' | 'unstage' | 'discard' | 'commit';

export function GitView() {
  const [status, setStatus] = createSignal<GitStatus | null>(null);
  const [message, setMessage] = createSignal('');
  const [amend, setAmend] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal<BusyAction | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [discardPath, setDiscardPath] = createSignal<string | null>(null);
  let discardTimer: ReturnType<typeof setTimeout> | undefined;

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      setStatus(await api.git.status());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // 挂载 + gitRefreshTick（checkout/createBranch/工具栏刷新后 bump → 重拉 status）
  createEffect(() => {
    gitRefreshTick();
    void refresh();
  });
  onCleanup(() => clearTimeout(discardTimer));

  async function mutate(action: 'stage' | 'unstage' | 'discard', paths: string[]): Promise<void> {
    if (paths.length === 0 || busy()) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await api.git[action](paths);
      await refresh();
    } catch (e) {
      setError((e as Error).message); // git 原始错误（spec §6.1）
    } finally {
      setBusy(null);
    }
  }

  async function runSync(action: SyncAction): Promise<void> {
    if (busy()) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const { output } = await api.git[action]();
      setNotice(output || t('git.syncDone'));
      await refresh(); // fetch 改变 ahead/behind，pull 改变工作区
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleCommit(): Promise<void> {
    if (!canCommit(status(), message()) || busy()) return;
    setBusy('commit');
    setError(null);
    setNotice(null);
    try {
      await api.git.commit([], message().trim(), amend());
      setMessage('');
      setAmend(false);
      setNotice(t('git.commitDone'));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** amend 勾选时用上一条提交信息预填输入框（仅在为空时），避免用户重打。 */
  async function toggleAmend(checked: boolean): Promise<void> {
    setAmend(checked);
    if (!checked || message().trim() !== '') return;
    try {
      const log = await api.git.log({ limit: 1 });
      const subject = log.commits[0]?.subject;
      if (subject) setMessage(subject);
    } catch { /* 读取失败就算了，用户自己输入 */ }
  }

  /** 丢弃是破坏性操作：第一次点击进入 3s 确认态，第二次才真正执行。 */
  function onDiscard(change: GitChange): void {
    if (busy()) return;
    if (discardPath() !== change.path) {
      setDiscardPath(change.path);
      clearTimeout(discardTimer);
      discardTimer = setTimeout(() => setDiscardPath(null), 3000);
      return;
    }
    setDiscardPath(null);
    clearTimeout(discardTimer);
    void mutate('discard', [change.path]);
  }

  function commitOnEnter(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.isComposing) void handleCommit();
  }

  const canSync = () => !!status()?.isRepo && !busy();

  return (
    <div class="git-view">
      <Show when={status()?.isRepo}>
        <div class="git-sync-bar">
          <div class="git-sync-meta">
            <span class="git-sync-branch" title={t('git.branch')}>{status()?.branch ?? 'HEAD'}</span>
            <Show when={status()?.upstream}>
              <span class="git-sync-upstream" title={t('git.upstream')}>{status()!.upstream}</span>
            </Show>
            <Show when={(status()?.ahead ?? 0) > 0 || (status()?.behind ?? 0) > 0}>
              <span class="git-sync-count" title={t('git.aheadBehind', { ahead: status()!.ahead, behind: status()!.behind })}>
                <Show when={status()!.ahead > 0}><span class="git-sync-item"><Icon name="sort-asc" size={12} />{status()!.ahead}</span></Show>
                <Show when={status()!.behind > 0}><span class="git-sync-item"><Icon name="sort-desc" size={12} />{status()!.behind}</span></Show>
              </span>
            </Show>
          </div>
          <div class="git-sync-actions">
            <For each={['fetch', 'pull', 'push'] as const}>
              {(action) => (
                <button class="git-sync-btn" disabled={!canSync()} onClick={() => void runSync(action)}>
                  {busy() === action ? t('loading') : t(`git.${action}`)}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div class="git-commit-bar">
        <input
          class="git-message"
          value={message()}
          onInput={(e) => setMessage(e.currentTarget.value)}
          onKeyDown={commitOnEnter}
          placeholder={t('git.commitPlaceholder')}
        />
        <button class="icon-btn git-commit-btn" disabled={!canCommit(status(), message()) || !!busy()} onClick={() => void handleCommit()}>
          {busy() === 'commit' ? t('loading') : t('git.commit')}
        </button>
      </div>
      <div class="git-commit-options">
        <label class="git-amend">
          <input type="checkbox" checked={amend()} disabled={!status()?.hasCommits || !!busy()}
            onChange={(e) => void toggleAmend(e.currentTarget.checked)} />
          {t('git.amend')}
        </label>
        <span class="git-staged-count">{t('git.stagedCount', { n: stagedChanges(status()).length })}</span>
      </div>

      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <Show when={notice()}>
        <div class="git-notice">{notice()}</div>
      </Show>
      <Show when={!loading() && status()?.isRepo === false}>
        <div class="view-placeholder">{t('git.notRepo')}</div>
      </Show>
      <Show when={loading()}>
        <div class="view-placeholder">{t('loading')}</div>
      </Show>
      <Show when={!loading() && status()?.isRepo && status()!.changes.length === 0}>
        <div class="view-placeholder">{t('git.empty')}</div>
      </Show>

      <div class="git-scroll">
        <Show when={stagedChanges(status()).length > 0}>
          <div class="git-group-head">
            <span>{t('git.staged')}</span>
            <span class="git-group-count">{stagedChanges(status()).length}</span>
            <button class="link-btn git-group-action" disabled={!!busy()}
              onClick={() => void mutate('unstage', stagedChanges(status()).map((c) => c.path))}>
              {t('git.unstageAll')}
            </button>
          </div>
          <ul class="git-list">
            <For each={stagedChanges(status())}>
              {(change) => (
                <li class="git-row">
                  <button class="git-row-main" onClick={() => void openGitDiff(change.path)} title={t('git.viewDiff')}>
                    <span class="git-path">{change.path}</span>
                    <span class={`git-status git-status-${statusClass(changeBadge(change, true))}`}>{changeBadge(change, true)}</span>
                  </button>
                  <button class="git-row-btn" title={t('git.unstage')} aria-label={`${t('git.unstage')} ${change.path}`}
                    disabled={!!busy()} onClick={() => void mutate('unstage', [change.path])}><Icon name="minus" size={18} /></button>
                  <button class={`git-row-btn ${discardPath() === change.path ? 'danger' : ''}`}
                    title={discardPath() === change.path ? t('git.confirmDiscard') : t('git.discard')}
                    aria-label={t('git.discard')} disabled={!!busy()} onClick={() => onDiscard(change)}>
                    <Icon name={discardPath() === change.path ? 'alert' : 'undo'} size={18} />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={unstagedChanges(status()).length > 0}>
          <div class="git-group-head">
            <span>{t('git.changes')}</span>
            <span class="git-group-count">{unstagedChanges(status()).length}</span>
            <button class="link-btn git-group-action" disabled={!!busy()}
              onClick={() => void mutate('stage', unstagedChanges(status()).map((c) => c.path))}>
              {t('git.stageAll')}
            </button>
          </div>
          <ul class="git-list">
            <For each={unstagedChanges(status())}>
              {(change) => (
                <li class="git-row">
                  <button class="git-row-main" onClick={() => void openGitDiff(change.path)} title={t('git.viewDiff')}>
                    <span class="git-path">{change.path}</span>
                    <span class={`git-status git-status-${statusClass(changeBadge(change, false))}`}>{changeBadge(change, false)}</span>
                  </button>
                  <button class="git-row-btn" title={t('git.stage')} aria-label={`${t('git.stage')} ${change.path}`}
                    disabled={!!busy()} onClick={() => void mutate('stage', [change.path])}><Icon name="plus" size={18} /></button>
                  <button class={`git-row-btn ${discardPath() === change.path ? 'danger' : ''}`}
                    title={discardPath() === change.path ? t('git.confirmDiscard') : t('git.discard')}
                    aria-label={t('git.discard')} disabled={!!busy()} onClick={() => onDiscard(change)}>
                    <Icon name={discardPath() === change.path ? 'alert' : 'undo'} size={18} />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}
