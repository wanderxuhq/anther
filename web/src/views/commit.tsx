// web/src/views/commit.tsx
// git-commit 标签视图：某次提交的元信息头 + 该提交 unified diff（只读 CodeMirror，复用 createDiffEditor）。
// 结构同 git-diff.tsx 模板：props.commit 变化 → 清旧编辑器 → 拉 show → 渲染；onCleanup 取消 + destroy。
import { createEffect, createSignal, Show, onCleanup } from 'solid-js';
import { api, type GitCommit } from '../api.ts';
import { createDiffEditor, type DiffHandle } from '../editor/diff.ts';
import { commitTimeLabel } from './history-model.ts';
import { t } from '../i18n.ts';

export function CommitView(props: { commit: string }) {
  let container: HTMLDivElement | undefined;
  const [meta, setMeta] = createSignal<GitCommit | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const commit = props.commit;
    const el = container!;
    let handle: DiffHandle | undefined;
    let cancelled = false;
    setError(null);
    setMeta(null);
    void (async () => {
      try {
        const { commit: c, diff } = await api.git.show(commit);
        if (cancelled) return;
        setMeta(c);
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
      <Show when={meta()}>
        <div class="git-commit-header">
          <span class="git-commit-meta">{meta()!.shortHash} · {meta()!.author} · {commitTimeLabel(meta()!)}</span>
          <span class="git-commit-subject">{meta()!.subject}</span>
        </div>
      </Show>
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <div ref={container} class="git-diff-editor" />
    </div>
  );
}
