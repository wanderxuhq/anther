import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { views } from './views/registry.tsx';
import { api } from './api.ts';
import { currentFile, roMode, setRoMode, setCurrentFile, pushState } from './stores.ts';
import { createEditor, type EditorHandle } from './editor/index.ts';

const NARROW_QUERY = '(max-width: 599px)';

export function useIsNarrow(): () => boolean {
  const [narrow, setNarrow] = createSignal(
    typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );
  if (typeof window !== 'undefined') {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
  }
  return narrow;
}

export function App() {
  const isNarrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [activeView, setActiveView] = createSignal('filetree');
  // 编辑器容器用信号持有：ref 回调（首帧 insert 时触发）会令下方 createEffect 重跑，
  // 天然消解「首帧 currentFile 已有值但容器未挂载」的竞态，无需 onMount 兜底。
  const [editorEl, setEditorEl] = createSignal<HTMLDivElement>();

  // ---- 编辑器 + 自动保存 ----
  let editor: EditorHandle | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveFailed = false; // 上次保存链失败 → 下次成功时 Toast 提示恢复
  let toastEl: HTMLDivElement | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // 最小 Toast（spec §8：Toast + 降级，不弹窗打断）。完整系统留给 Task 14/15。
  function showToast(message: string, kind: 'success' | 'error') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.toggle('toast-success', kind === 'success');
    toastEl.classList.toggle('toast-error', kind === 'error');
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl?.classList.remove('show'), 3000);
  }

  /** 自动保存：防抖 1s → api.writeFile(path, text, 当前 roMode)；失败每 1s 重试共 3 次，仍失败 Toast */
  function scheduleSave(path: string, text: string) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            await api.writeFile(path, text, roMode()); // roMode 每次尝试时现读
            if (saveFailed) {
              saveFailed = false;
              showToast('已恢复保存', 'success');
            }
            return;
          } catch (e) {
            if (attempt >= 2) {
              // 已失败 3 次（attempt 0/1/2，间隔 1s）
              saveFailed = true;
              showToast(`保存失败：${(e as Error).message}`, 'error');
              return;
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      })();
    }, 1000);
  }

  function handleEditorChange(doc: string) {
    // 只由用户编辑触发（适配层已过滤程序性 dispatch）；编辑必然发生在
    // 有当前文件的场景，此处为防御性 guard
    const path = currentFile();
    if (!path) return;
    scheduleSave(path, doc);
  }

  let loadSeq = 0; // 递增序号：丢弃过期 readFile 响应（竞态 guard 的加强版）

  async function loadDoc(path: string) {
    const el = editorEl();
    if (!el) return;
    const seq = ++loadSeq;
    try {
      const { content } = await api.readFile(path);
      // 响应到达时当前文件已切换 / 已有更新的加载请求 → 丢弃过期响应
      if (path !== currentFile() || seq !== loadSeq) return;
      if (!editor) {
        editor = createEditor(el, {
          initialDoc: content,
          readOnly: roMode(),
          onChange: handleEditorChange,
        });
      } else {
        editor.setDoc(content);
      }
      editor.setReadOnly(roMode());
    } catch (e) {
      // 过期请求的失败不打扰当前文件（竞态 guard 同规则）
      if (path !== currentFile() || seq !== loadSeq) return;
      // spec §8：Toast + 降级到文件树（清空当前文件 → 编辑器清空，用户回到文件树）
      showToast(`打开失败：${(e as Error).message}`, 'error');
      setCurrentFile(null);
      pushState();
    }
  }

  // currentFile 变化 → 加载文档到编辑器；path 为 null（关闭当前标签）→ 清空编辑器
  createEffect(() => {
    const path = currentFile();
    if (!path) {
      editor?.setDoc('');
      return;
    }
    if (!editorEl()) return;
    void loadDoc(path);
  });

  // 只读切换 → Compartment reconfigure（effect 只读 roMode，无需重读文件）
  createEffect(() => {
    editor?.setReadOnly(roMode());
  });

  onCleanup(() => {
    clearTimeout(saveTimer);
    editor?.destroy();
    toastEl?.remove();
  });

  return (
    <div class={`app ${isNarrow() ? 'narrow' : 'wide'}`}>
      <header class="toolbar">
        <button class="icon-btn" onClick={() => setDrawerOpen(!drawerOpen())} title="菜单">
          ☰
        </button>
        <span class="toolbar-path">
          {currentFile() ?? <span class="toolbar-path-hint">未打开文件</span>}
        </span>
        <button
          class={`icon-btn ${roMode() ? '' : 'active'}`}
          onClick={() => {
            const next = !roMode();
            setRoMode(next);
            pushState();
          }}
          title={roMode() ? '切换为编辑模式' : '切换为只读模式'}
        >
          ✎
        </button>
      </header>

      <main class="editor-area">
        <div ref={setEditorEl} class="editor-container" />
      </main>

      <Show when={drawerOpen() || !isNarrow()}>
        <div class="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
        <aside class="drawer">
          <nav class="drawer-views">
            <For each={views}>
              {(v) => (
                <button
                  class={activeView() === v.id ? 'view-tab active' : 'view-tab'}
                  onClick={() => setActiveView(v.id)}
                  title={v.title}
                >
                  {v.icon}
                </button>
              )}
            </For>
          </nav>
          <div class="drawer-content">
            <For each={views}>
              {(v) => (
                <Show when={activeView() === v.id}>{v.render()}</Show>
              )}
            </For>
          </div>
        </aside>
      </Show>
    </div>
  );
}
