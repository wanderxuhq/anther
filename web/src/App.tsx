import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { views } from './views/registry.tsx';
import { api } from './api.ts';
import { currentFile, roMode, setRoMode, setCurrentFile, pushState, fontScale } from './stores.ts';
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
  let pendingPath: string | undefined; // 防抖窗口内的最新待保存内容（flushSave 用）
  let pendingDoc: string | undefined;
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

  /** 保存链：api.writeFile(path, text, ro)；失败每 1s 重试共 3 次，仍失败 Toast。
   *  ro 传值则固定用该值（flushSave 用——切换前捕获 ro=0，重试不随模式翻转）；缺省每次尝试现读 */
  async function saveWithRetry(path: string, text: string, ro?: boolean) {
    for (let attempt = 0; ; attempt++) {
      try {
        await api.writeFile(path, text, ro !== undefined ? ro : roMode());
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
  }

  /** 自动保存：防抖 1s → saveWithRetry；记录最新待保存内容供 flushSave */
  function scheduleSave(path: string, text: string) {
    pendingPath = path;
    pendingDoc = text;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveWithRetry(path, text);
    }, 1000);
  }

  /** 编辑→只读切换前调用：清掉防抖计时器，立即保存待写内容。
   *  此刻 roMode() 仍为 false，固定传值保证重试期间不因已切只读而 403 */
  function flushSave() {
    clearTimeout(saveTimer);
    if (pendingPath === undefined || pendingDoc === undefined) return;
    const path = pendingPath;
    const doc = pendingDoc;
    pendingPath = undefined;
    pendingDoc = undefined;
    void saveWithRetry(path, doc, roMode());
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
      const { content, utf8 } = await api.readFile(path);
      // 响应到达时当前文件已切换 / 已有更新的加载请求 → 丢弃过期响应
      if (path !== currentFile() || seq !== loadSeq) return;
      // spec §5.3：非 UTF-8 文件仍可浏览，但保存仅支持 UTF-8 → Toast 提示
      if (!utf8) showToast('非 UTF-8 文件，仅支持 UTF-8 保存', 'error');
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

  // 字号（?fs= 参数）：走 html 根字号 %；CodeMirror .cm-scroller 未设自身 font-size，沿继承链传导
  createEffect(() => {
    document.documentElement.style.fontSize = `${fontScale()}%`;
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
            // 编辑→只读：先把防抖中的修改立即落盘（此时 roMode 仍为 false，ro=0 放行）
            if (!roMode()) flushSave();
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
