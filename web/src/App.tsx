import { fileMutationLocked, pathWithin, setBeforeFileMutation } from './file-operations.ts';
import { fileTargetKey, fileTargetLabel } from './file-target.ts';
import { documentPreviewUrl } from './readers/document-file.ts';
import { cancelReaderNavigation, registerReaderNavigation } from './readers/navigation.ts';
import { createSignal, createMemo, createEffect, For, Show, on, onCleanup } from 'solid-js';
import { views } from './views/registry.tsx';
import { TerminalView } from './views/terminal.tsx';
import { GitView } from './views/git.tsx';
import { GitDiffView } from './views/git-diff.tsx';
import { HistoryView } from './views/history.tsx';
import { BranchView } from './views/branch.tsx';
import { CommitView } from './views/commit.tsx';
import { api } from './api.ts';
import {
  activeTab, currentTabId, setCurrentTabId, openTerminal, closePreviewTab,
  readingLocationFor, readerRestoreRequest, updateReadingLocation,
  openGit, openDatabaseTab, closeTab,
  archiveChain, archiveEntry, openArchiveEntry, activeArchiveRoot,
  currentFile, roMode, setRoMode, pushState, fontScale,
  pendingGoto, setPendingGoto, docLoadedPath, setDocLoadedPath,
  editorHandle, setEditorHandle,
  activePanel, selectPanel, drawerOpen, setDrawerOpen, updateFilePosition,
  openGitHistory, openGitBranch, createBranch, currentBranch, setCurrentBranch, gitRefreshTick, setGitRefreshTick,
} from './stores.ts';
import { createEditor, type EditorHandle } from './editor/index.ts';
import { describeLanguage, loadLanguage } from './editor/language.ts';
import { t } from './i18n.ts';
import { isMarkdownFile, parseMarkdownDocument } from './markdown.ts';
import { MarkdownPreview } from './components/markdown-preview.tsx';
import { Icon } from './components/icons.tsx';
import { preparingDownload, startDownload, setBeforeDownload } from './download.ts';
import { isImageFile, isBinaryImage } from './image.ts';
import { LocatedImagePreview as ImagePreview, LocatedTablePreview as TablePreview } from './components/located-preview.tsx';
import { FilePreview, type PreviewFile } from './components/file-preview.tsx';
import { isArchiveFile } from './archive.ts';
import { archiveSession, archiveBusy, cancelArchive, ensureArchive, downloadArchiveEntry } from './archive-sessions.ts';
import { loadArchiveFile, hasArchiveDocument, releaseArchiveFile, type ArchiveDocument } from './archive-file.ts';
import { archiveLimits } from './archive-settings.ts';
import { ArchiveFeedback } from './components/archive-feedback.tsx';
import { DatabasePane } from './views/database.tsx';
import { DatabaseIcon } from './components/database-icon.tsx';
import type { DatabaseController } from './database/controller.ts';
import { ArchiveOptions } from './components/archive-options.tsx';
import { SystemInfoDialog } from './components/system-info.tsx';

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
  const [imageFile, setImageFile] = createSignal<{ path: string; url: string } | null>(null);
  createEffect(on([currentFile, archiveEntry, archiveChain], () => cancelReaderNavigation(), { defer: true }));
  const [filePreview, setFilePreview] = createSignal<PreviewFile | null>(null);
  const [archiveFile, setArchiveFile] = createSignal<ArchiveDocument | null>(null);
  const browsingArchive = () => !!currentFile() && isArchiveFile(currentFile()!);
  const documentPath = () => browsingArchive() ? archiveEntry() ?? archiveChain().at(-1) ?? currentFile() : currentFile();
  const documentKey = () => currentFile() ? fileTargetKey({ path: currentFile()!, archive: browsingArchive() && archiveEntry() ? { entry: archiveEntry()!, chain: archiveChain() } : undefined }) : '';
  const documentReadOnly = () => roMode() || browsingArchive();
  const currentPreview = createMemo(() => filePreview()?.path === documentPath() ? filePreview() : null);
  const showImagePreview = createMemo(() => isImageFile(documentPath()) && (isBinaryImage(documentPath()) || documentReadOnly()));
  const canPreviewMarkdown = () => documentReadOnly() && isMarkdownFile(documentPath()) && !currentPreview();
  const showMarkdownPreview = () => canPreviewMarkdown() && !markdownSource();
  const canPreviewTable = () => documentReadOnly() && /\.(csv|tsv)$/i.test(documentPath() ?? '') && !currentPreview();
  const showTablePreview = () => canPreviewTable() && !markdownSource();
  const showRenderedDocument = () => showMarkdownPreview() || showTablePreview();

  // 打开文件或重新进入只读时默认预览；手动切源码不改变只读状态。
  createEffect(on([currentFile, archiveEntry, archiveChain, roMode], () => setMarkdownSource(false)));

  let navigateMarkdown: ((id: string) => void) | null = null;
  const restoreMarkdown = () => {
    const location = readingLocationFor(documentKey());
    try { navigateMarkdown?.(location?.kind === 'markdown' ? location.heading : ''); }
    catch { navigateMarkdown?.(''); }
  };
  createEffect(on(readerRestoreRequest, (request) => {
    if (request?.key === documentKey()) restoreMarkdown();
  }));
  createEffect(() => {
    const document = loadedDoc();
    if (!document || document.path !== currentFile() || !isMarkdownFile(documentPath())) return;
    const key = documentKey();
    const disconnect = registerReaderNavigation(key, { async goToOutline(id) {
      if (documentReadOnly()) {
        setMarkdownSource(false);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (documentKey() !== key) return;
        if (!navigateMarkdown) throw new Error('Markdown preview unavailable');
        navigateMarkdown(id);
      } else {
        const line = parseMarkdownDocument(document.content).lines.get(id);
        if (line === undefined) throw new Error('Heading unavailable');
        editor?.gotoLine(line);
      }
    } });
    onCleanup(disconnect);
  });

  const activeTabIsTerminal = () => activeTab()?.kind === 'terminal';
  // 主区域二选一：文件编辑器 ↔ 终端 / git / git-diff 标签视图
  const activeDatabase = createMemo(() => { const tab = activeTab(); return tab?.kind === 'database' ? tab : null; });
  const [databaseController, setDatabaseController] = createSignal<DatabaseController | null>(null);
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
    if (tab.kind === 'database') return `${fileTargetLabel(tab)}${tab.object ? ` › ${tab.object.name} · ${t(`database.${tab.mode}`)}` : ''}`;
    if (tab.kind === 'terminal') return tab.name;
    if (tab.kind === 'git') return t('view.git');
    if (tab.kind === 'git-diff') return tab.path;
    if (browsingArchive()) return <>
      <button class="toolbar-path-link" onClick={() => void openArchiveEntry(currentFile()!, null)}>{currentFile()}</button>
      <For each={archiveChain()}>{(name, index) => <><span> › </span><button class="toolbar-path-link" onClick={() => void openArchiveEntry(currentFile()!, null, archiveChain().slice(0, index() + 1))}>{name}</button></>}</For>
      <Show when={archiveEntry()}> › {archiveEntry()}</Show>
    </>;
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

  setBeforeFileMutation(async (path) => {
    await flushSave();
    if ([...failedSavePaths].some((failed) => pathWithin(failed, path))) {
      throw new Error(t('filetree.saveFirst'));
    }
  });
  setBeforeDownload(async (path, directory) => {
    await flushSave();
    if ([...failedSavePaths].some((failed) => failed === path || (directory && (path === '.' || failed.startsWith(`${path}/`))))) {
      throw new Error(t('download.saveFirst'));
    }
  });
  const downloadPath = () => currentFile() ?? activeDatabase()?.path ?? activeGitDiffPath();
  async function handleDownload() {
    const path = downloadPath();
    if (!path || preparingDownload()) return;
    try {
      const database = activeDatabase();
      if (database?.archive) {
        await downloadArchiveEntry(database.path, database.archive.entry, database.archive.chain);
      } else if (browsingArchive()) {
        const value = archiveFile(), name = archiveEntry(), chain = archiveChain();
        if (value && name === value.name) await startDownload({ url: value.url, filename: value.name.split('/').pop()! });
        else if (name) await downloadArchiveEntry(path, name, chain);
        else if (chain.length) await downloadArchiveEntry(path, chain[chain.length - 1], chain.slice(0, -1));
        else await startDownload(path);
      } else await startDownload(path);
    } catch (e) {
      showToast(t('download.failed', { msg: (e as Error).message }), 'error');
    }
  }

  function handleEditorChange(doc: string) {
    // 只由用户编辑触发（适配层已过滤程序性 dispatch）；编辑必然发生在
    // 有当前文件的场景，此处为防御性 guard
    const path = currentFile();
    if (!path || browsingArchive() || fileMutationLocked(path)) return;
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
  // 抽屉底部 ⓘ：服务器系统信息（进入抽屉的视图导航区，避免挤占工具栏）
  const [systemOpen, setSystemOpen] = createSignal(false);

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

  const clearArchiveFile = () => {
    const previous = archiveFile();
    setArchiveFile(null);
    if (previous) releaseArchiveFile(previous);
  };
  const clearEditor = () => {
    editor?.destroy(); editor = undefined;
    setEditorHandle(null); setLoadedDoc(null);
  };
  async function showText(el: HTMLDivElement, content: string, root: string, name: string, seq: number, virtual = false) {
    const path = virtual ? null : root;
    if (!editor) {
      editor = createEditor(el, {
        initialDoc: content, readOnly: documentReadOnly() || fileMutationLocked(path), path,
        onChange: handleEditorChange,
        onReveal: () => setMarkdownSource(true),
        onSelectionChange: (line) => { if (!showRenderedDocument()) updateFilePosition(line); },
        onLspNotice: (msg, kind) => showToast(msg, kind),
      });
      setEditorHandle(editor);
    } else {
      // Clear the old language service before installing a virtual document.
      editor.setReadOnly(true);
      editor.setDoc(content, path);
    }
    editor.setReadOnly(documentReadOnly() || fileMutationLocked(path));
    setLoadedDoc({ path: root, content });
    setDocLoadedPath(root);
    const desc = describeLanguage(name);
    if (desc) {
      const ext = await loadLanguage(desc);
      if (root !== currentFile() || seq !== loadSeq) return;
      editor?.setLanguage(ext);
    }
  }

  async function loadDoc(path: string, imagePreview = false, password?: string) {
    const el = editorEl();
    if (!el) return;
    const seq = ++loadSeq, virtual = isArchiveFile(path);
    const chain = [...archiveChain()], name = archiveEntry();
    setDocLoadedPath(null);
    setLoadedDoc(null);
    setImageFile(null);
    setFilePreview(null);
    clearArchiveFile();
    try {
      await flushSave();
      if (path !== currentFile() || seq !== loadSeq) return;
      if (virtual) {
        clearEditor();
        if (archiveBusy(path) && (!name || !hasArchiveDocument(path, chain, name))) cancelArchive(path);
        if (!name) { await ensureArchive(path, password, !!archiveSession(path, chain)?.error, chain); return; }
        if (isArchiveFile(name)) { await openArchiveEntry(path, null, [...chain, name]); return; }
        const file = await loadArchiveFile(path, chain, name, password);
        if (path !== currentFile() || seq !== loadSeq) { releaseArchiveFile(file); return; }
        setArchiveFile(file);
        if (file.kind === 'sqlite') { openDatabaseTab(path, { archive: { entry: name, chain }, object: null, mode: 'data' }); return; }
        if (file.kind === 'image') { setImageFile({ path: name, url: file.url }); return; }
        if (file.kind !== 'text') {
          setFilePreview({ path: name, url: file.url, kind: file.kind, size: file.blob.size, mime: file.mime, modified: '' });
          return;
        }
        await showText(el, file.content!, path, name, seq, true);
        return;
      }
      if (imagePreview) {
        clearEditor();
        setImageFile({ path, url: `${api.imageUrl(path)}&v=${Date.now()}-${seq}` });
        return;
      }
      const info = await api.fileInfo(path);
      if (path !== currentFile() || seq !== loadSeq) return;
      const openPreview = (kind: PreviewFile['kind']) => {
        clearEditor();
        setFilePreview({ ...info, kind, path, url: kind === 'pdf' || kind === 'epub' ? documentPreviewUrl(path, info) : `${api.previewUrl(path)}&v=${Date.now()}-${seq}` });
      };
      if (info.kind === 'sqlite') { clearEditor(); openDatabaseTab(path); void closeTab(path).catch(() => {}); return; }
      if (info.kind !== 'text') { openPreview(info.kind); return; }
      const { content, utf8 } = await api.readFile(path);
      if (path !== currentFile() || seq !== loadSeq) return;
      if (!utf8 || content.includes('\0')) { openPreview('binary'); return; }
      await showText(el, content, path, path, seq);
    } catch (e) {
      if (path !== currentFile() || seq !== loadSeq) return;
      // Archive failures/passwords remain inline, with the same selected document.
      if (virtual) return;
      showToast(t('toast.openFail', { msg: (e as Error).message }), 'error');
      setCurrentTabId(null);
      pushState('replace');
      setDocLoadedPath(null);
    }
  }

  let previousArchive: string | null = null;
  createEffect(on([currentFile, activeArchiveRoot, showImagePreview, archiveEntry, archiveChain, archiveLimits, editorEl], () => {
    const path = currentFile();
    const root = activeArchiveRoot();
    const sharedEntry = path && archiveEntry() && hasArchiveDocument(path, archiveChain(), archiveEntry()!);
    if (previousArchive && (previousArchive !== root || (path && !sharedEntry))) cancelArchive(previousArchive, previousArchive !== root);
    previousArchive = root;
    if (!path) {
      loadSeq++;
      void flushSave();
      editor?.setDoc('');
      setLoadedDoc(null); setImageFile(null); setFilePreview(null);
      clearArchiveFile(); setDocLoadedPath(null);
      return;
    }
    if (editorEl()) void loadDoc(path, showImagePreview());
  }));

  // 只读切换 → Compartment reconfigure（effect 只读 roMode，无需重读文件）
  // 注意：必须先求值 roMode() 再调用——editor 由异步加载延迟创建，effect 首次运行时
  // 仍为 undefined，`editor?.setReadOnly(roMode())` 的可选链会短路并跳过参数求值，
  // 依赖永不建立，✎ 切换永不生效（2026-08-08 修复）。
  createEffect(() => {
    const ro = documentReadOnly() || fileMutationLocked(currentFile());
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
    cancelReaderNavigation();
    loadSeq++;
    if (previousArchive) cancelArchive(previousArchive, true);
    clearArchiveFile();
    setBeforeDownload(undefined);
    setBeforeFileMutation(undefined);
    window.removeEventListener('keydown', onKeyDown);
    clearTimeout(saveTimer);
    editor?.destroy();
    toastEl?.remove();
  });

  return (
    <div class={`app ${isNarrow() ? 'narrow' : 'wide'}`}>
      <header class="toolbar" classList={{ 'git-toolbar': isGitKind() }}>
        <button class="icon-btn" onClick={() => setDrawerOpen(!drawerOpen())} title={t('menu')} aria-label={t('menu')}>
          <Icon name="menu" />
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
                  <Icon name="git-changes" />
                </button>
                <button class="icon-btn git-toolbar-action git-view-tab" classList={{ active: activeKind() === 'git-history' }}
                  onClick={() => openGitHistory()} title={t('git.history')} aria-label={t('git.history')}
                  aria-current={activeKind() === 'git-history' ? 'page' : undefined}>
                  <Icon name="git-history" />
                </button>
              </nav>
              <button class="icon-btn git-toolbar-action" onClick={() => setGitRefreshTick((x) => x + 1)} title={t('git.refresh')} aria-label={t('git.refresh')}>
                <Icon name="refresh" />
              </button>
              <button class="icon-btn" onClick={() => setBranchDialogOpen(true)} title={t('git.newBranch')} aria-label={t('git.newBranch')}>
                <Icon name="plus" />
              </button>
            </>
          }
        >
          <button class="icon-btn" onClick={() => editorHandle()?.openSearch()} title={t('find')} aria-label={t('find')} disabled={!currentFile() || docLoadedPath() !== currentFile()}>
            <Icon name="search" />
          </button>
          <span class="toolbar-path" title={browsingArchive() ? [currentFile(), ...archiveChain(), archiveEntry()].filter(Boolean).join(' › ') : undefined}>{toolbarPathLabel()}</span>
          <Show when={activeTab()?.kind === 'file'}>
            <button
              class="icon-btn preview-close"
              onClick={() => void closePreviewTab().catch(() => { /* 关闭失败时保留预览 */ })}
              title={t('preview.close')}
              aria-label={t('preview.close')}
            >
              <Icon name="close" />
            </button>
          </Show>
          <Show when={canPreviewMarkdown() || canPreviewTable()}>
            <button
              class="icon-btn markdown-toggle"
              onClick={() => setMarkdownSource((source) => !source)}
              title={canPreviewTable() ? (showTablePreview() ? t('preview.showSource') : t('preview.showTable')) : (showMarkdownPreview() ? t('markdown.showSource') : t('markdown.showPreview'))}
              aria-label={canPreviewTable() ? (showTablePreview() ? t('preview.showSource') : t('preview.showTable')) : (showMarkdownPreview() ? t('markdown.showSource') : t('markdown.showPreview'))}
            >
              <Icon name={showRenderedDocument() ? 'code' : 'eye'} />
            </button>
          </Show>
          <Show when={browsingArchive() || activeDatabase()?.archive}><ArchiveOptions /></Show>
          <Show when={activeDatabase()}>{(tab) => <>
            <Show when={tab().object}>
              <For each={['data', 'structure'] as const}>{(mode) => <button class={`icon-btn ${tab().mode === mode ? 'active' : ''}`}
                aria-label={t(`database.${mode}`)} title={t(`database.${mode}`)} aria-pressed={tab().mode === mode}
                onClick={() => openDatabaseTab(tab().path, { object: tab().object, mode, archive: tab().archive })}>
                <DatabaseIcon kind={mode === 'data' ? 'table' : 'structure'}/>
              </button>}</For>
            </Show>
            <button class="icon-btn" onClick={() => databaseController()?.refresh()} aria-label={t('database.refresh')} title={t('database.refresh')}><DatabaseIcon kind="refresh"/></button>
          </>}</Show>
          <button class="icon-btn file-download" onClick={() => void handleDownload()}
            disabled={!downloadPath() || preparingDownload() || (browsingArchive() ? !!(archiveEntry() || archiveChain().length) && archiveBusy(currentFile()!) : !!currentFile() && !showImagePreview() && !currentPreview() && docLoadedPath() !== currentFile())}
            title={t('download.file')} aria-label={t('download.file')} aria-busy={preparingDownload()}>
            <Icon name="download" />
          </button>
          <button
            class={`icon-btn ${!activeDatabase() && !documentReadOnly() && !isBinaryImage(documentPath()) && !currentPreview() ? 'active' : ''}`}
            disabled={!!activeDatabase() || browsingArchive() || isBinaryImage(documentPath()) || (!!currentFile() && docLoadedPath() !== currentFile() && !showImagePreview())}
            onClick={() => {
              // 编辑→只读：先把防抖中的修改立即落盘（切换前保存，改动不丢）
              if (!roMode()) flushSave();
              const next = !roMode();
              setRoMode(next);
              pushState();
            }}
            title={browsingArchive() ? t('archive.readonly') : roMode() ? t('switchEdit') : t('switchReadonly')}
            aria-label={browsingArchive() ? t('archive.readonly') : roMode() ? t('switchEdit') : t('switchReadonly')}
          >
            <Icon name="edit" />
          </button>
        </Show>
      </header>

      <main class="editor-area" classList={{ 'archive-view': browsingArchive() }}>
        <Show when={activeDatabase()?.id} keyed>{(_id) => <DatabasePane tab={activeDatabase()!} onController={setDatabaseController}/>}</Show>
        <Show when={browsingArchive()}>
          <ArchiveFeedback path={currentFile()!} chain={archiveChain()} entry={archiveEntry()} priority={30} retry={(password) => void loadDoc(currentFile()!, false, password)} />
          <Show when={!archiveEntry()}><div class="binary-preview">{t('archive.choose')}</div></Show>
          <Show when={archiveEntry() && !archiveFile() && !archiveSession(currentFile()!, archiveChain())?.busy && !archiveSession(currentFile()!, archiveChain())?.error}>
            <div class="binary-preview"><button class="link-btn" onClick={() => void loadDoc(currentFile()!)}>{t('archive.retry')}</button></div>
          </Show>
          <Show when={archiveFile()?.truncated}><div class="archive-notice">{t('archive.textLimit')}</div></Show>
        </Show>
        <div
          ref={setEditorEl}
          class="editor-container"
          style={(activeKind() === 'file' || activeKind() === null) && !showRenderedDocument() && !showImagePreview() && !currentPreview() && (!currentFile() || docLoadedPath() === currentFile()) ? undefined : 'display:none'}
        />
        <Show when={currentPreview()} keyed>{(file) => <FilePreview file={file} navigationKey={documentKey()} />}</Show>
        <Show when={currentFile() && !browsingArchive() && !showImagePreview() && !currentPreview() && !showRenderedDocument() && docLoadedPath() !== currentFile()}>
          <div class="view-placeholder" role="status">{t('loading')}</div>
        </Show>
        <Show when={showImagePreview() && (!browsingArchive() || archiveFile())}>
          <Show when={imageFile()?.path === documentPath()} fallback={<div class="view-placeholder" role="status">{t('loading')}</div>}>
            <Show when={imageFile()} keyed>
              {(file) => <ImagePreview path={file.path} url={file.url} navigationKey={documentKey()} />}
            </Show>
          </Show>
        </Show>
        <Show when={showMarkdownPreview() && (!browsingArchive() || archiveFile())}>
          <Show when={loadedDoc()?.path === currentFile()} fallback={<div class="view-placeholder" role="status">{t('loading')}</div>}>
            <Show when={documentPath()} keyed>
              {(path) => <MarkdownPreview content={loadedDoc()?.content ?? ''} path={path} allowRelativeLinks={!browsingArchive()}
                onHeading={(heading) => updateReadingLocation(documentKey(), { kind: 'markdown', heading })}
                onNavigator={(navigate) => { navigateMarkdown = navigate; if (navigate) restoreMarkdown(); }} />}
            </Show>
          </Show>
        </Show>
        <Show when={showTablePreview() && (!browsingArchive() || archiveFile())}>
          <Show when={loadedDoc()?.path === currentFile()} fallback={<div class="view-placeholder" role="status">{t('loading')}</div>}>
            <Show when={documentPath()} keyed>{(path) => <TablePreview path={path} content={loadedDoc()?.content ?? ''} navigationKey={documentKey()} />}</Show>
          </Show>
        </Show>
        <Show when={currentFile() && !documentReadOnly() && docLoadedPath() === currentFile()}>
          <button
            class="complete-btn"
            onClick={() => editorHandle()?.startCompletion()}
            title={t('complete')}
            aria-label={t('complete')}
          >
            <Icon name="sparkles" />
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

      <Show when={systemOpen()}>
        <SystemInfoDialog onClose={() => setSystemOpen(false)} />
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
                  <Icon name={v.icon} />
                </button>
              )}
            </For>
            <button class="view-tab" onClick={() => void handleNewTerminal()} title={t('newTerminal')} aria-label={t('newTerminal')}>
              <Icon name="terminal-plus" />
            </button>
            <button class="view-tab" onClick={() => void openGit()} title={t('view.git')} aria-label={t('view.git')}>
              <Icon name="git-branch" />
            </button>
            <button
              class="view-tab"
              onClick={() => { setSystemOpen(true); setDrawerOpen(false); }}
              title={t('system.info')}
              aria-label={t('system.info')}
            >
              <Icon name="info" />
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
