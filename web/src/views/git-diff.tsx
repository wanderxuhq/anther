// web/src/views/git-diff.tsx
// git-diff 标签视图：单文件行内 diff（红绿块 + 状态栏 + 新文件行号）。顶部「用编辑器打开」按钮不变。
import { createEffect, createSignal, Show, onCleanup } from 'solid-js';
import { api } from '../api.ts';
import { createInlineDiffEditor, type DiffHandle } from '../editor/inline-diff.ts';
import { parseUnifiedDiff, type DiffFile } from './diff-model.ts';
import { openTab } from '../stores.ts';
import { t } from '../i18n.ts';

export function GitDiffView(props: { path: string }) {
  let container: HTMLDivElement | undefined;
  const [error, setError] = createSignal<string | null>(null);
  const [file, setFile] = createSignal<DiffFile | null>(null);

  // props.path 变化 → 整个 effect 重跑：清状态再拉新 diff → parse 单文件
  createEffect(() => {
    const path = props.path;
    let cancelled = false;
    setError(null);
    setFile(null);
    void (async () => {
      try {
        const { diff } = await api.git.diff(path);
        if (cancelled) return;
        setFile(parseUnifiedDiff(diff)[0] ?? null);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    })();
    onCleanup(() => { cancelled = true; });
  });

  // file 就绪后创建行内编辑器（container 随渲染绑定；二进制 → 占位无编辑器）
  createEffect(() => {
    const f = file();
    let handle: DiffHandle | undefined;
    onCleanup(() => handle?.destroy());
    if (!f || f.status === 'binary' || !container) return;
    handle = createInlineDiffEditor(container, f);
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
      <Show when={file()?.status === 'binary'} fallback={<div ref={container} class="git-diff-editor" />}>
        <div class="git-commit-binary">{t('git.binary')}</div>
      </Show>
    </div>
  );
}
