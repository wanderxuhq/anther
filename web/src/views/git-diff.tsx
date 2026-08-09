// web/src/views/git-diff.tsx
// git-diff 标签视图：只读 CodeMirror 渲染 unified diff 文本（复用 createEditor 适配层，
// 白赚虚拟滚动/主题跟随/字号缩放/搜索）。顶部「用编辑器打开」按钮 → 该文件文件标签。
import { createEffect, createSignal, Show, onCleanup } from 'solid-js';
import { api } from '../api.ts';
import { createDiffEditor, type DiffHandle } from '../editor/diff.ts';
import { openTab } from '../stores.ts';
import { t } from '../i18n.ts';

export function GitDiffView(props: { path: string }) {
  let container: HTMLDivElement | undefined;
  const [error, setError] = createSignal<string | null>(null);

  // props.path 变化（切换 diff 标签）→ 整个 effect 重跑：旧编辑器先清，再拉新 diff
  createEffect(() => {
    const path = props.path;
    const el = container!;
    let handle: DiffHandle | undefined;
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const { diff } = await api.git.diff(path);
        if (cancelled) return;
        handle = createDiffEditor(el, diff);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    })();
    onCleanup(() => {
      cancelled = true;
      handle?.destroy();
    });
  });

  return (
    <div class="git-diff-view">
      <div class="git-diff-header">
        <span class="git-diff-path">{props.path}</span>
        <button class="icon-btn" onClick={() => void openTab(props.path)} title={t('git.openInEditor')}>
          ✎
        </button>
      </div>
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <div ref={container} class="git-diff-editor" />
    </div>
  );
}
