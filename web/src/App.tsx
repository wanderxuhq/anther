import { createSignal, createEffect, For, Show, on, onCleanup } from 'solid-js';
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
  activePanel, selectPanel, drawerOpen, setDrawerOpen, updateFilePosition,
  openGitHistory, openGitBranch, createBranch, currentBranch, setCurrentBranch, gitRefreshTick, setGitRefreshTick,
} from './stores.ts';
import { createEditor, type EditorHandle } from './editor/index.ts';
import { describeLanguage, loadLanguage } from './editor/language.ts';
import { t } from './i18n.ts';
import { isMarkdownFile } from './markdown.ts';
import { MarkdownPreview } from './components/markdown-preview.tsx';
import { preparingDownload, startDownload, setBeforeDownload } from './download.ts';

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
  // 编辑器容器用信号持有：ref 回调（首帧 insert 时触发）会令下方 createEffect 重跑，
  // 天然消解「首帧 currentFile 已有值但容器未挂载」的竞态，无需 onMount 兜底。
  const [editorEl, setEditorEl] = createSignal<HTMLDivElement>();
  const [loadedDoc, setLoadedDoc] = createSignal<{ path: string; content: string } | null>(null);
  const [markdownSource, setMarkdownSource] = createSignal(false);
  const canPreviewMarkdown = () => roMode() && isMarkdownFile(currentFile());
  const showMarkdownPreview = () => canPreviewMarkdown() && !markdownSource();

  // 打开文件或重新进入只读时默认预览；手动切源码不改变只读状态。
  createEffect(on([currentFile, roMode], () => setMarkdownSource(false)));

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
      selectPanel('search');
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // ---- 编辑器 + 自动保存 ----
  let editor: EditorHandle | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPath: string | undefined; // 防抖窗口内的最新待保存内容（flushSave 用）
  let pendingDoc: string | undefined;
  let saveChain = Promise.resolve();
  let saveFailed = false; // 上次保存链失败 → 下次成功时 Toast 提示恢复
  const failedSavePaths = new Set<string>();
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

  /** 保存链：api.writeFile(path, text)；失败每 1s 重试共 3 次，仍失败 Toast。
   *  只读仅控制编辑器（用户决策 2026-08-11）：保存不传 ro，服务端始终放行 */
  async function saveWithRetry(path: string, text: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        await api.writeFile(path, text);
        failedSavePaths.delete(path);
        if (saveFailed) {
          saveFailed = false;
          showToast(t('toast.restored'), 'success');
        }
        return;
      } catch (e) {
        if (attempt >= 2) {
          // 已失败 3 次（attempt 0/1/2，间隔 1s）
          saveFailed = true;
          failedSavePaths.add(path);
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
      void flushSave();
    }, 1000);
  }

  /** 编辑→只读切换前调用：清掉防抖计时器，立即保存待写内容（只读切换前落盘，改动不丢） */
  function flushSave(): Promise<void> {
    clearTimeout(saveTimer);
    if (pendingPath === undefined || pendingDoc === undefined) return saveChain;
    const path = pendingPath;
    const doc = pendingDoc;
    pendingPath = undefined;
    pendingDoc = undefined;
    saveChain = saveChain.then(() => saveWithRetry(path, doc));
    return saveChain;
  }

  setBeforeDownload(async (path, directory) => {
    await flushSave();
    if ([...failedSavePaths].some((failed) => failed === path || (directory && (path === '.' || failed.startsWith(`${path}/`))))) {
      throw new Error(t('download.saveFirst'));
    }
  });
  const downloadPath = () => currentFile() ?? activeGitDiffPath();
  async function handleDownload() {
    const path = downloadPath();
    if (!path || preparingDownload()) return;
    try {
      await startDownload(path);
    } catch (e) {
      showToast(t('download.failed', { msg: (e as Error).message }), 'error');
    }
  }

  function handleEditorChange(doc: string) {
    // 只由用户编辑触发（适配层已过滤程序性 dispatch）；编辑必然发生在
    // 有当前文件的场景，此处为防御性 guard
    const path = currentFile();
    if (!path) return;
    setLoadedDoc({ path, content: doc });
    if (roMode()) return; // 只读模式不自动保存（checkout 前切只读后，防抖内的后续编辑不落盘）
    scheduleSave(path, doc);
  }

  /**
   * 切换分支保护（spec §5.4，用户规则）：
   * 1) flushSave() 立即保存防抖中的待写内容
   * 2) setRoMode(true) → 编辑器转只读（handleEditorChange 的 roMode guard 同时生效 → 只读期间不自动保存）
   * 3) api.git.checkout(name)
   * 4) 成功 → currentBranch 更新 + gitRefreshTick bump（git 面板/历史/分支全部重拉）；
   *    已打开的文件标签不关闭（用户要求），切回文件标签时 currentFile 变化 → loadDoc 自动从新分支重读；
   *    编辑器保持只读（用户规则），用户回文件标签按 ✎ 可自行切回可写
   * 5) 失败 → Toast git 原始 stderr；分支不变；编辑器保持「已保存 + 只读」（flushSave 已把防抖内容落盘旧分支，改动不丢）
   */
  async function checkoutBranch(name: string): Promise<void> {
    const saved = flushSave();
    setRoMode(true);
    pushState('replace');
    await saved;
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
    setDocLoadedPath(null);
    try {
      // 切文件/浏览器历史导航前先保存旧文档，返回旧文件时等保存完成再读取。
      await flushSave();
      if (path !== currentFile() || seq !== loadSeq) return;
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
          onReveal: () => setMarkdownSource(true),
          onSelectionChange: updateFilePosition,
          onLspNotice: (msg, kind) => showToast(msg, kind),
        });
        setEditorHandle(editor);
      } else {
        editor.setDoc(content, path);
      }
      editor.setReadOnly(roMode());
      setLoadedDoc({ path, content });
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
      pushState('replace');
      setDocLoadedPath(null);
    }
  }

  // currentFile 变化 → 加载文档到编辑器；path 为 null（关闭当前标签）→ 清空编辑器
  createEffect(() => {
    const path = currentFile();
    if (!path) {
      void flushSave();
      editor?.setDoc('');
      setLoadedDoc(null);
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
    if (g && currentFile() === g.path && loaded === g.path && h) {
      setPendingGoto(null);
      h.gotoLine(g.line0, g.endLine0, g.reveal);
    }
  });

  // 字号（?fs= 参数）：走 html 根字号 %；CodeMirror .cm-scroller 未设自身 font-size，沿继承链传导
  createEffect(() => {
    document.documentElement.style.fontSize = `${fontScale()}%`;
  });

  onCleanup(() => {
    setBeforeDownload(undefined);
    window.removeEventListener('keydown', onKeyDown);
    clearTimeout(saveTimer);
    editor?.destroy();
    toastEl?.remove();
  });

  return (
    <div class={`app ${isNarrow() ? 'narrow' : 'wide'}`}>
      <header class="toolbar" classList={{ 'git-toolbar': isGitKind() }}>
        <button class="icon-btn" onClick={() => setDrawerOpen(!drawerOpen())} title={t('menu')}>
          ☰
        </button>
        <Show
          when={!isGitKind()}
          fallback={
            <>
              {/* Git 工具栏：分支管理、待提交、历史、刷新、新建分支。 */}
              <button class="icon-btn git-branch-btn" onClick={() => openGitBranch()} title={t('git.branch')}>
                {currentBranch() ?? '—'}
              </button>
              <nav class="git-view-nav" aria-label={t('view.git')}>
                <button class="icon-btn git-toolbar-action git-view-tab" classList={{ active: activeKind() === 'git' }}
                  onClick={() => openGit()} title={t('git.changes')} aria-label={t('git.changes')}
                  aria-current={activeKind() === 'git' ? 'page' : undefined}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 5h11M9 12h11M9 19h11M3 5h1M3 12h1M3 19h1" />
                  </svg>
                </button>
                <button class="icon-btn git-toolbar-action git-view-tab" classList={{ active: activeKind() === 'git-history' }}
                  onClick={() => openGitHistory()} title={t('git.history')} aria-label={t('git.history')}
                  aria-current={activeKind() === 'git-history' ? 'page' : undefined}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
              </nav>
              <button class="icon-btn git-toolbar-action" onClick={() => setGitRefreshTick((x) => x + 1)} title={t('git.refresh')} aria-label={t('git.refresh')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 7a9 9 0 0 0-15-1L2 9m0-6v6h6M4 17a9 9 0 0 0 15 1l3-3m0 6v-6h-6" />
                </svg>
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
          <Show when={canPreviewMarkdown()}>
            <button
              class="icon-btn markdown-toggle"
              onClick={() => setMarkdownSource((source) => !source)}
              title={showMarkdownPreview() ? t('markdown.showSource') : t('markdown.showPreview')}
              aria-label={showMarkdownPreview() ? t('markdown.showSource') : t('markdown.showPreview')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <Show when={showMarkdownPreview()} fallback={
                  <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>
                }>
                  <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />
                </Show>
              </svg>
            </button>
          </Show>
          <button class="icon-btn file-download" onClick={() => void handleDownload()}
            disabled={!downloadPath() || preparingDownload() || (!!currentFile() && docLoadedPath() !== currentFile())}
            title={t('download.file')} aria-label={t('download.file')} aria-busy={preparingDownload()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
            </svg>
          </button>
          <button
            class={`icon-btn ${roMode() ? '' : 'active'}`}
            onClick={() => {
              // 编辑→只读：先把防抖中的修改立即落盘（切换前保存，改动不丢）
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
          style={(activeKind() === 'file' || activeKind() === null) && !showMarkdownPreview() ? undefined : 'display:none'}
        />
        <Show when={showMarkdownPreview()}>
          <Show when={loadedDoc()?.path === currentFile()} fallback={<div class="view-placeholder" role="status">{t('loading')}</div>}>
            <Show when={currentFile()} keyed>
              {(_path) => <MarkdownPreview content={loadedDoc()?.content ?? ''} />}
            </Show>
          </Show>
        </Show>
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
                  class={activePanel() === v.id ? 'view-tab active' : 'view-tab'}
                  onClick={() => selectPanel(v.id)}
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
                <Show when={activePanel() === v.id}>{v.render()}</Show>
              )}
            </For>
          </div>
        </aside>
      </Show>
    </div>
  );
}
