// web/src/views/commit.tsx
// git-commit 标签视图：元信息头 + 该提交多文件 diff，GitHub PR「code changes」式堆叠。
// 每文件一个卡片：路径（rename 显示 a → b）+ `+N −M` 计数 + 行内 diff 编辑器；二进制占位。
import { createEffect, createSignal, Show, For, onCleanup } from 'solid-js';
import { api, type GitCommit } from '../api.ts';
import { createInlineDiffEditor, type DiffHandle } from '../editor/inline-diff.ts';
import { parseUnifiedDiff, type DiffFile } from './diff-model.ts';
import { commitTimeLabel } from './history-model.ts';
import { t } from '../i18n.ts';

// 单个文件卡：路径头 + 增减计数 + 行内编辑器（每卡自持 handle，onCleanup 逐个 destroy）
function FileCard(props: { file: DiffFile }) {
  let editorEl: HTMLDivElement | undefined;
  createEffect(() => {
    let handle: DiffHandle | undefined;
    onCleanup(() => handle?.destroy());
    if (props.file.status === 'binary' || !editorEl) return;
    handle = createInlineDiffEditor(editorEl, props.file);
  });
  return (
    <div class="git-commit-file">
      <div class="git-commit-file-head">
        <span class="git-commit-file-path">
          {props.file.oldPath ? `${props.file.oldPath} → ${props.file.path}` : props.file.path}
        </span>
        <span class="git-commit-file-count">
          <span class="diff-count-add">+{props.file.addCount}</span>
          <span class="diff-count-del">−{props.file.delCount}</span>
        </span>
      </div>
      <Show when={props.file.status === 'binary'} fallback={<div ref={editorEl} class="git-diff-editor" />}>
        <div class="git-commit-binary">{t('git.binary')}</div>
      </Show>
    </div>
  );
}

export function CommitView(props: { commit: string }) {
  const [meta, setMeta] = createSignal<GitCommit | null>(null);
  const [files, setFiles] = createSignal<DiffFile[]>([]);
  const [error, setError] = createSignal<string | null>(null);

  // props.commit 变化 → 清状态 → 拉 show → parse 多文件（cancelled 竞态守卫，同既有模板）
  createEffect(() => {
    const commit = props.commit;
    let cancelled = false;
    setError(null);
    setMeta(null);
    setFiles([]);
    void (async () => {
      try {
        const { commit: c, diff } = await api.git.show(commit);
        if (cancelled) return;
        setMeta(c);
        setFiles(parseUnifiedDiff(diff));
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    })();
    onCleanup(() => { cancelled = true; });
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
      <div class="git-commit-files">
        <For each={files()}>{(file) => <FileCard file={file} />}</For>
      </div>
    </div>
  );
}
