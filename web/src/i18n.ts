// web/src/i18n.ts
// 国际化：默认英语，按浏览器语言自动切换（zh* → 中文，其余 → 英语），
// ?lang=en|zh 可覆盖（测试/调试用）。轻量字典实现，零新增依赖。
// 初始加载和浏览器历史恢复都会应用语言；t() 读 lang 信号即时更新界面。
import { createSignal } from 'solid-js';
import { parseUrl } from './url-state.ts';

export type Lang = 'en' | 'zh';

const messages: Record<Lang, Record<string, string>> = {
  en: {
    menu: 'Menu',
    find: 'Find',
    complete: 'Complete',
    switchEdit: 'Switch to edit mode',
    switchReadonly: 'Switch to read-only mode',
    newTerminal: 'New terminal',
    noFileOpen: 'No file open',
    'download.file': 'Download file',
    'filetree.download': 'Download',
    'download.preparing': 'Preparing download…',
    'download.saveFirst': 'Save your changes successfully before downloading',
    'download.failed': 'Failed to download: {msg}',
    'markdown.showPreview': 'Show Markdown preview',
    'markdown.showSource': 'Show Markdown source',
    'toast.terminalCreateFail': 'Failed to create terminal: {msg}',
    'toast.saveFail': 'Failed to save: {msg}',
    'toast.restored': 'Save restored',
    'toast.notUtf8': 'Non-UTF-8 file — only UTF-8 save is supported',
    'toast.openFail': 'Failed to open: {msg}',
    'toast.lspUnavailable': 'Language server unavailable: {msg}',
    'toast.lspRestarted': 'Language server restarted',
    'view.files': 'Files',
    'view.tabs': 'Tabs',
    'view.search': 'Search',
    close: 'Close',
    'tabs.empty': 'No tabs yet — open a file from the file tree',
    'search.placeholder': 'Search file contents',
    'search.caseSensitive': 'Aa Match case',
    'search.excludePlaceholder': 'Exclude dirs (comma-separated)',
    'search.searching': 'Searching',
    'search.cancel': 'cancel',
    'search.stats': '{files} files / {matches} matches',
    'search.truncated': '(too many results — refine your query)',
    'search.hint': 'Type a query to start searching',
    'search.noResults': 'No results',
    'filetree.newFile': 'New file',
    'filetree.uploadFile': 'Upload file',
    'filetree.uploading': 'Uploading…',
    'filetree.uploadExists': 'A file named "{name}" already exists',
    'filetree.newDir': 'New folder',
    'filetree.create': 'Create',
    'filetree.rename': 'Rename',
    'filetree.confirmDelete': 'Confirm delete?',
    'filetree.delete': 'Delete',
    'filetree.actions': 'Actions',
    'filetree.new': 'New',
    loading: 'Loading…',
    cancel: 'Cancel',
    'terminal.name': 'Terminal {n}',
    'view.git': 'Git',
    'git.changes': 'Changes',
    'git.commit': 'Commit',
    'git.commitPlaceholder': 'Commit message',
    'git.selectAll': 'Select all',
    'git.clearAll': 'Clear selection',
    'git.notRepo': 'Not a git repository',
    'git.empty': 'No changes to commit',
    'git.viewDiff': 'View diff',
    'git.openInEditor': 'Open in editor',
    'git.history': 'History',
    'git.binary': 'Binary file',
    'git.branch': 'Branches',
    'git.refresh': 'Refresh',
    'git.newBranch': 'New branch',
    'git.newBranchPlaceholder': 'Branch name',
    'git.create': 'Create',
    'git.switchTo': 'Switch to "{branch}"?',
    'git.switch': 'Switch',
    'git.emptyHistory': 'No commits yet',
    'git.graphTruncated': 'Showing first 1000 commits',
    'git.checkoutDone': 'Switched to {branch}',
    'git.checkoutFail': 'Failed to switch: {msg}',
    'git.branchCreated': 'Branch {name} created',
    'git.branchCreateFail': 'Failed to create branch: {msg}',
    'git.time.justNow': 'just now',
    'git.time.minute': '{n} min ago',
    'git.time.hour': '{n} hr ago',
    'git.time.day': '{n} days ago',
  },
  zh: {
    menu: '菜单',
    find: '查找',
    complete: '补全',
    switchEdit: '切换为编辑模式',
    switchReadonly: '切换为只读模式',
    newTerminal: '新建终端',
    noFileOpen: '未打开文件',
    'download.file': '下载文件',
    'filetree.download': '下载',
    'download.preparing': '正在准备下载…',
    'download.saveFirst': '请先成功保存修改后再下载',
    'download.failed': '下载失败：{msg}',
    'markdown.showPreview': '显示 Markdown 预览',
    'markdown.showSource': '显示 Markdown 源码',
    'toast.terminalCreateFail': '新建终端失败：{msg}',
    'toast.saveFail': '保存失败：{msg}',
    'toast.restored': '已恢复保存',
    'toast.notUtf8': '非 UTF-8 文件，仅支持 UTF-8 保存',
    'toast.openFail': '打开失败：{msg}',
    'toast.lspUnavailable': '语言服务不可用：{msg}',
    'toast.lspRestarted': '语言服务已重启',
    'view.files': '文件',
    'view.tabs': '标签',
    'view.search': '搜索',
    close: '关闭',
    'tabs.empty': '暂无标签，从文件树打开文件',
    'search.placeholder': '搜索文件内容',
    'search.caseSensitive': 'Aa 大小写',
    'search.excludePlaceholder': '排除目录（逗号分隔）',
    'search.searching': '搜索中…',
    'search.cancel': '取消',
    'search.stats': '{files} 个文件 / {matches} 处匹配',
    'search.truncated': '（结果过多，请细化关键词）',
    'search.hint': '输入关键词开始搜索',
    'search.noResults': '无结果',
    'filetree.newFile': '新建文件',
    'filetree.uploadFile': '上传文件',
    'filetree.uploading': '上传中…',
    'filetree.uploadExists': '已存在同名文件「{name}」',
    'filetree.newDir': '新建目录',
    'filetree.create': '创建',
    'filetree.rename': '重命名',
    'filetree.confirmDelete': '确认删除？',
    'filetree.delete': '删除',
    'filetree.actions': '操作',
    'filetree.new': '新建',
    loading: '加载中…',
    cancel: '取消',
    'terminal.name': '终端 {n}',
    'view.git': 'Git',
    'git.changes': '待提交',
    'git.commit': '提交',
    'git.commitPlaceholder': '提交信息',
    'git.selectAll': '全选',
    'git.clearAll': '取消全选',
    'git.notRepo': '不是 git 仓库',
    'git.empty': '无改动可提交',
    'git.viewDiff': '查看 diff',
    'git.openInEditor': '用编辑器打开',
    'git.history': '历史',
    'git.binary': '二进制文件',
    'git.branch': '分支',
    'git.refresh': '刷新',
    'git.newBranch': '新建分支',
    'git.newBranchPlaceholder': '分支名',
    'git.create': '创建',
    'git.switchTo': '切换到「{branch}」？',
    'git.switch': '切换',
    'git.emptyHistory': '暂无提交',
    'git.graphTruncated': '已显示前 1000 条提交',
    'git.checkoutDone': '已切换到 {branch}',
    'git.checkoutFail': '切换失败：{msg}',
    'git.branchCreated': '已创建分支 {name}',
    'git.branchCreateFail': '创建分支失败：{msg}',
    'git.time.justNow': '刚刚',
    'git.time.minute': '{n} 分钟前',
    'git.time.hour': '{n} 小时前',
    'git.time.day': '{n} 天前',
  },
};

export const [lang, setLang] = createSignal<Lang>('en');

/** 纯函数语言检测：?lang= 覆盖 > 浏览器语言（zh* → zh）> 默认 en。可单测。 */
export function detectLang(browserLangs: readonly string[], urlOverride: string | null): Lang {
  if (urlOverride === 'zh') return 'zh';
  if (urlOverride === 'en') return 'en';
  for (const l of browserLangs) {
    if (l.toLowerCase().startsWith('zh')) return 'zh';
  }
  return 'en';
}

/** 翻译：{key} 插值；缺失 key 回退英文，再回退 key 本身（保证永不显示空白） */
export function t(key: string, params?: Record<string, string | number>): string {
  const table = messages[lang()] ?? messages.en;
  let s = table[key] ?? messages.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** 页面加载时调用一次：检测语言 → 设信号 + <html lang>。返回识别结果。 */
export function initI18n(): Lang {
  return applyLanguage(parseUrl(window.location.href).lang);
}

/** 初始加载和浏览器历史恢复共用；无显式覆盖时跟随浏览器语言。 */
export function applyLanguage(override: Lang | null): Lang {
  const langs = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  const l = detectLang(langs, override);
  setLang(l);
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  return l;
}
