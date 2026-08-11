import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { views } from './views/registry.tsx';
import { TerminalView } from './views/terminal.tsx';
import { GitView } from './views/git.tsx';
import { GitDiffView } from './views/git-diff.tsx';
import { HistoryView } from './views/history.tsx';
import { BranchView } from './views/branch.tsx';
import { CommitView } from './views/commit.tsx';
import { api } from './api.ts';
import {
  activeTab, currentTabId, setCurrentTabId, openTerminal,
  openGit,
  currentFile, roMode, setRoMode, pushState, fontScale,
  pendingGoto, setPendingGoto, docLoadedPath, setDocLoadedPath,
  editorHandle, setEditorHandle,
  openGitHistory, openGitBranch, createBranch, currentBranch, setCurrentBranch, gitRefreshTick, setGitRefreshTick,
} from './stores.ts';
import { createEditor, type EditorHandle } from './editor/index.ts';
import { describeLanguage, loadLanguage } from './editor/language.ts';
import { t } from './i18n.ts';

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

  const activeTabIsTerminal = () => activeTab()?.kind === 'terminal';
  // 主区域二选一：文件编辑器 ↔ 终端 / git / git-diff 标签视图
  const activeKind = () => activeTab()?.kind ?? null;
  // git-diff 前台时其 diff 文件路径（TS 收窄：单次读 activeTab() 再分支）
  const activeGitDiffPath = (): string | null => {
    const tab = activeTab();
    return tab?.kind === 'git-diff' ? tab.path : null;
  };

  // git 相关标签（git 面板 / 历史 / 分支 / 提交）激活 → 工具栏切 git 态（spec §1；git-diff 保持文件态）
  const isGitKind = () => {
    const k = activeTab()?.kind;
    return k === 'git' || k === 'git-history' || k === 'git-branch' || k === 'git-commit';
  };
  // git-commit 前台时其短 hash（TS 收窄：单次读 activeTab() 再分支，同 activeGitDiffPath 约定）
  const activeCommitHash = (): string | null => {
    const tab = activeTab();
    return tab?.kind === 'git-commit' ? tab.commit : null;
  };

  // toolbar 路径文案：文件路径 / 终端名 / 'Git' / diff 文件路径（未打开 → 提示）
  const toolbarPathLabel = () => {
    const tab = activeTab();
    if (!tab) return <span class="toolbar-path-hint">{t('noFileOpen')}</span>;
    if (tab.kind === 'terminal') return tab.name;
    if (tab.kind === 'git') return t('view.git');
    if (tab.kind === 'git-diff') return tab.path;
    return currentFile() ?? <span class="toolbar-path-hint">{t('noFileOpen')}</span>;
  };

  async function handleNewTerminal() {
    try {
      await openTerminal();
    } catch (e) {
      showToast(t('toast.terminalCreateFail', { msg: (e as Error).message }), 'error');
    }
  }

  // 桌面端 Ctrl+Shift+F → 全局搜索（打开抽屉 + 切到搜索视图；SearchView 挂载时自动聚焦）
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setDrawerOpen(true);
      setActiveView('search');
    }
  };
  window.addEventListener('keydown', onKeyDown);

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
          showToast(t('toast.restored'), 'success');
        }
        return;
      } catch (e) {
        if (attempt >= 2) {
          // 已失败 3 次（attempt 0/1/2，间隔 1s）
          saveFailed = true;
          showToast(t('toast.saveFail', { msg: (e as Error).message }), 'error');
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
    if (roMode()) return; // 只读模式不自动保存（checkout 前切只读后，防抖内的后续编辑不落盘）
    scheduleSave(path, doc);
  }

  /**
   * 切换分支保护（spec §5.4，用户规则）：
   * 1) flushSave() 立即保存防抖中的待写内容（此刻 roMode 仍 false，ro=0 放行）
   * 2) setRoMode(true) → 编辑器转只读（handleEditorChange 的 roMode guard 同时生效 → 只读期间不自动保存）
   * 3) api.git.checkout(name)
   * 4) 成功 → currentBranch 更新 + gitRefreshTick bump（git 面板/历史/分支全部重拉）；
   *    已打开的文件标签不关闭（用户要求），切回文件标签时 currentFile 变化 → loadDoc 自动从新分支重读；
   *    编辑器保持只读（用户规则），用户回文件标签按 ✎ 可自行切回可写
   * 5) 失败 → Toast git 原始 stderr；分支不变；编辑器保持「已保存 + 只读」（flushSave 已把防抖内容落盘旧分支，改动不丢）
   */
  async function checkoutBranch(name: string): Promise<void> {
    flushSave();
    setRoMode(true);
    try {
      await api.git.checkout(name);
      setCurrentBranch(name);
      setGitRefreshTick((x) => x + 1);
      showToast(t('git.checkoutDone', { branch: name }), 'success');
    } catch (e) {
      showToast(t('git.checkoutFail', { msg: (e as Error).message }), 'error');
    }
  }

  // 工具栏 ➕ 新建分支：直接弹内联 dialog（复用 dialog-backdrop/dialog-card）
  const [branchDialogOpen, setBranchDialogOpen] = createSignal(false);
  const [newBranchName, setNewBranchName] = createSignal('');
  const [branchCreating, setBranchCreating] = createSignal(false);

  async function handleNewBranch(): Promise<void> {
    const name = newBranchName().trim();
    if (!name || branchCreating()) return;
    setBranchCreating(true);
    try {
      await createBranch(name);
      setBranchDialogOpen(false);
      setNewBranchName('');
      showToast(t('git.branchCreated', { name }), 'success');
    } catch (e) {
      showToast(t('git.branchCreateFail', { msg: (e as Error).message }), 'error');
    } finally {
      setBranchCreating(false);
    }
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
      if (!utf8) showToast(t('toast.notUtf8'), 'error');
      if (!editor) {
        editor = createEditor(el, {
          initialDoc: content,
          readOnly: roMode(),
          path,
          onChange: handleEditorChange,
          onLspNotice: (msg, kind) => showToast(msg, kind),
        });
        setEditorHandle(editor);
      } else {
        editor.setDoc(content, path);
      }
      editor.setReadOnly(roMode());
      setDocLoadedPath(path); // 搜索跳转消费 effect 的前提：文档确已加载
      // 语法高亮：文档先显示纯文本，语言异步加载完成后补上（VS Code 同款体验）。
      // 竞态守卫与 readFile 一致：响应到达时已切换文件/有更新加载请求 → 丢弃。
      const desc = describeLanguage(path);
      if (desc) {
        const ext = await loadLanguage(desc);
        if (path !== currentFile() || seq !== loadSeq) return;
        editor?.setLanguage(ext);
      }
    } catch (e) {
      // 过期请求的失败不打扰当前文件（竞态 guard 同规则）
      if (path !== currentFile() || seq !== loadSeq) return;
      // spec §8：Toast + 降级到文件树（清空当前文件 → 编辑器清空，用户回到文件树）
      showToast(t('toast.openFail', { msg: (e as Error).message }), 'error');
      setCurrentTabId(null);
      pushState();
      setDocLoadedPath(null);
    }
  }

  // currentFile 变化 → 加载文档到编辑器；path 为 null（关闭当前标签）→ 清空编辑器
  createEffect(() => {
    const path = currentFile();
    if (!path) {
      editor?.setDoc('');
      // 同步清 docLoadedPath：closeTab/popstate 置 null 时若滞留旧 path，
      // 消费 effect 的信任前提「docLoadedPath() === g.path ⟹ editor 持有目标文档」被打破，
      // 会在空文档上误 gotoLine 并消费掉 pendingGoto（真跳转随后丢失）
      setDocLoadedPath(null);
      return;
    }
    if (!editorEl()) return;
    void loadDoc(path);
  });

  // 只读切换 → Compartment reconfigure（effect 只读 roMode，无需重读文件）
  // 注意：必须先求值 roMode() 再调用——editor 由异步加载延迟创建，effect 首次运行时
  // 仍为 undefined，`editor?.setReadOnly(roMode())` 的可选链会短路并跳过参数求值，
  // 依赖永不建立，✎ 切换永不生效（2026-08-08 修复）。
  createEffect(() => {
    const ro = roMode();
    editor?.setReadOnly(ro);
  });

  // 搜索跳转消费（Task 17）：目标文件加载完成后执行 gotoLine。
  // 条件 docLoadedPath() === g.path 保证 editor 持有的就是目标文档——
  // currentFile 在 openTab 里同步变化，而文档是异步加载的，只看 currentFile 会
  // 在加载完成前对旧文档 gotoLine（行号错位/越界钳制到旧文档末尾行）
  createEffect(() => {
    const g = pendingGoto();
    const loaded = docLoadedPath();
    const h = editorHandle();
    if (g && loaded === g.path && h) {
      setPendingGoto(null);
      h.gotoLine(g.line0);
    }
  });

  // 字号（?fs= 参数）：走 html 根字号 %；CodeMirror .cm-scroller 未设自身 font-size，沿继承链传导
  createEffect(() => {
    document.documentElement.style.fontSize = `${fontScale()}%`;
  });

  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown);
    clearTimeout(saveTimer);
    editor?.destroy();
    toastEl?.remove();
  });

  return (
    <div class={`app ${isNarrow() ? 'narrow' : 'wide'}`}>
      <header class="toolbar">
        <button class="icon-btn" onClick={() => setDrawerOpen(!drawerOpen())} title={t('menu')}>
          ☰
        </button>
        <Show
          when={!isGitKind()}
          fallback={
            <>
              {/* git 态：⑂ 分支名 → 分支标签；📜 历史；🔄 刷新（bump tick）；➕ 新建分支 dialog */}
              <button class="icon-btn git-branch-btn" onClick={() => openGitBranch()} title={t('git.branch')}>
                {currentBranch() ?? '—'}
              </button>
              <button class="icon-btn" onClick={() => openGitHistory()} title={t('git.history')}>
                📜
              </button>
              <button class="icon-btn" onClick={() => setGitRefreshTick((x) => x + 1)} title={t('git.refresh')}>
                🔄
              </button>
              <button class="icon-btn" onClick={() => setBranchDialogOpen(true)} title={t('git.newBranch')}>
                ➕
              </button>
            </>
          }
        >
          <button class="icon-btn" onClick={() => editorHandle()?.openSearch()} title={t('find')} disabled={!currentFile()}>
            🔍
          </button>
          <span class="toolbar-path">{toolbarPathLabel()}</span>
          <button
            class={`icon-btn ${roMode() ? '' : 'active'}`}
            onClick={() => {
              // 编辑→只读：先把防抖中的修改立即落盘（此时 roMode 仍 false，ro=0 放行）
              if (!roMode()) flushSave();
              const next = !roMode();
              setRoMode(next);
              pushState();
            }}
            title={roMode() ? t('switchEdit') : t('switchReadonly')}
          >
            ✎
          </button>
        </Show>
      </header>

      <main class="editor-area">
        <div
          ref={setEditorEl}
          class="editor-container"
          style={activeKind() === 'file' || activeKind() === null ? undefined : 'display:none'}
        />
        <Show when={currentFile() && !roMode()}>
          <button
            class="complete-btn"
            onClick={() => editorHandle()?.startCompletion()}
            title={t('complete')}
            aria-label={t('complete')}
          >
            ⌘
          </button>
        </Show>
        <Show when={activeKind() === 'terminal'}>
          <TerminalView id={currentTabId()!} />
        </Show>
        <Show when={activeKind() === 'git'}>
          <GitView />
        </Show>
        <Show when={activeGitDiffPath()}>
          <GitDiffView path={activeGitDiffPath()!} />
        </Show>
        <Show when={activeKind() === 'git-history'}>
          <HistoryView />
        </Show>
        <Show when={activeKind() === 'git-branch'}>
          <BranchView onCheckout={(name) => void checkoutBranch(name)} />
        </Show>
        <Show when={activeCommitHash()}>
          <CommitView commit={activeCommitHash()!} />
        </Show>
      </main>

      {/* 工具栏 ➕ 新建分支 dialog（Enter 提交 + 点遮罩关闭） */}
      <Show when={branchDialogOpen()}>
        <div class="dialog-backdrop" onClick={() => setBranchDialogOpen(false)}>
          <div class="dialog-card" onClick={(e) => e.stopPropagation()}>
            <h3 class="dialog-title">{t('git.newBranch')}</h3>
            <input
              class="dialog-input"
              value={newBranchName()}
              onInput={(e) => setNewBranchName(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleNewBranch(); }}
              placeholder={t('git.newBranchPlaceholder')}
            />
            <div class="dialog-actions">
              <button class="icon-btn" onClick={() => setBranchDialogOpen(false)}>{t('cancel')}</button>
              <button
                class="icon-btn"
                disabled={!newBranchName().trim() || branchCreating()}
                onClick={() => void handleNewBranch()}
              >
                {branchCreating() ? t('loading') : t('git.create')}
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={drawerOpen() || !isNarrow()}>
        <div class="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
        <aside class="drawer">
          <nav class="drawer-views">
            <For each={views}>
              {(v) => (
                <button
                  class={activeView() === v.id ? 'view-tab active' : 'view-tab'}
                  onClick={() => setActiveView(v.id)}
                  title={v.title()}
                >
                  {v.icon}
                </button>
              )}
            </For>
            <button class="view-tab" onClick={() => void handleNewTerminal()} title={t('newTerminal')}>
              ➕
            </button>
            <button class="view-tab" onClick={() => void openGit()} title={t('view.git')}>
              🕘
            </button>
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
