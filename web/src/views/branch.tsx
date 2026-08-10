// web/src/views/branch.tsx
// 分支管理视图：顶部内联新建区 + 本地分支列表（当前 ✓；点非当前行 → 确认 dialog → 调 App 传入的 onCheckout）。
// 新建（stores.createBranch）/切换（App.checkoutBranch）成功后都会 bump gitRefreshTick → 本视图 effect 重拉列表。
import { createEffect, createSignal, Show, For } from 'solid-js';
import { api, type GitBranches } from '../api.ts';
import { createBranch, gitRefreshTick } from '../stores.ts';
import { t } from '../i18n.ts';

export function BranchView(props: { onCheckout: (name: string) => void }) {
  const [data, setData] = createSignal<GitBranches | null>(null);
  const [newName, setNewName] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [confirmName, setConfirmName] = createSignal<string | null>(null); // 待确认切换的分支
  const [error, setError] = createSignal<string | null>(null);

  // 挂载 + gitRefreshTick（checkout / createBranch 成功后重拉）
  createEffect(() => {
    gitRefreshTick();
    void (async () => {
      try {
        setData(await api.git.branches());
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  });

  async function handleCreate(): Promise<void> {
    const name = newName().trim();
    if (!name || creating()) return;
    setCreating(true);
    try {
      await createBranch(name); // 成功 → stores bump tick → 列表自动重拉
      setNewName('');
    } catch (e) {
      setError((e as Error).message); // git 原始 stderr（spec §6.1）
    } finally {
      setCreating(false);
    }
  }

  return (
    <div class="branch-view">
      <div class="branch-create-bar">
        <input
          class="branch-name-input"
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          placeholder={t('git.newBranchPlaceholder')}
        />
        <button class="icon-btn" disabled={!newName().trim() || creating()} onClick={() => void handleCreate()}>
          {creating() ? t('loading') : t('git.create')}
        </button>
      </div>
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <Show when={data() && !data()?.isRepo}>
        <div class="view-placeholder">{t('git.notRepo')}</div>
      </Show>
      <ul class="branch-list">
        <For each={data()?.branches ?? []}>
          {(b) => (
            <li>
              {/* 当前分支行禁用点击（spec §6.1：切到已是当前的分支 → 无操作） */}
              <button class="branch-row" disabled={b.current} onClick={() => setConfirmName(b.name)}>
                <span class="branch-current">{b.current ? '✓' : ''}</span>
                <span class="branch-name">{b.name}</span>
                <span class="branch-tip">{b.tip}</span>
              </button>
            </li>
          )}
        </For>
      </ul>

      {/* 切换确认 dialog（复用 dialog-backdrop/dialog-card，spec §2） */}
      <Show when={confirmName()}>
        <div class="dialog-backdrop" onClick={() => setConfirmName(null)}>
          <div class="dialog-card" onClick={(e) => e.stopPropagation()}>
            <h3 class="dialog-title">{t('git.switchTo', { branch: confirmName()! })}</h3>
            <div class="dialog-actions">
              <button class="icon-btn" onClick={() => setConfirmName(null)}>{t('cancel')}</button>
              <button
                class="icon-btn"
                onClick={() => {
                  const n = confirmName();
                  setConfirmName(null);
                  if (n) props.onCheckout(n);
                }}
              >
                {t('git.switch')}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
