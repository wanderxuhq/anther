// web/src/views/diff-model.ts
// unified diff → 多文件行内模型（纯函数，node --test 直接导入可测）。
// 解析 `git show`/`git diff` 输出的 unified diff 文本 → 按文件拆分 + hunk 子块分组，
// 供行内 diff 编辑器（红绿背景 + 状态栏 + 新文件行号）一次性构建。
export type DiffLine = { kind: 'ctx' | 'del' | 'add'; text: string };   // text = 去 `-`/`+`/空格 前缀后的原始内容
export type DiffHunk = { oldStart: number; newStart: number; lines: DiffLine[] };
export type DiffFile = {
  path: string;                              // 显示路径（b/ 侧；删除文件取 a/ 侧）
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';
  oldPath?: string;                          // rename 时显示 a → b
  addCount: number;
  delCount: number;
  hunks: DiffHunk[];                         // binary → []
};

/** 按 `^diff --git` 拆多文件段（commit 视图一次 show() → 每文件一节，GitHub 式堆叠）。 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const section of text.split(/^diff --git /m)) {
    if (!section.trim()) continue; // 首个段（diff 前空行）跳过
    files.push(parseFile('diff --git ' + section));
  }
  return files;
}

function parseFile(seg: string): DiffFile {
  const lines = seg.split('\n');
  const header = lines[0]; // 'diff --git a/x b/y'

  // 状态识别：在文件头元信息行中探测（任一命中即定型）
  let status: DiffFile['status'] = 'modified';
  for (const line of lines) {
    if (line.startsWith('Binary files ')) { status = 'binary'; break; }
    if (line.startsWith('new file mode ')) { status = 'added'; break; }
    if (line.startsWith('deleted file mode ')) { status = 'deleted'; break; }
    if (line.startsWith('similarity index ') || line.startsWith('rename from ') || line.startsWith('rename to ')) {
      status = 'renamed';
      break;
    }
  }

  // 路径：b/ 侧显示；删除文件（b 侧 /dev/null）取 a/ 侧
  const oldPath = header.replace(/^diff --git a\//, '').replace(/ b\/.*$/, '');
  const newPath = header.replace(/^diff --git a\/.* b\//, '');
  const path = status === 'deleted' ? oldPath : newPath;

  // hunk 解析：`@@ -o[,n] +n[,m] @@` 头；hunk 内保持「ctx→del→add」子块顺序（VSCode 同款）
  const hunks: DiffHunk[] = [];
  let addCount = 0;
  let delCount = 0;
  let cur: DiffHunk | null = null;
  for (const line of lines) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      cur = { oldStart: Number(h[1]), newStart: Number(h[2]), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('\\ ')) continue; // "\ No newline at end of file" 丢弃（VSCode 亦忽略）
    if (line.startsWith('+')) { cur.lines.push({ kind: 'add', text: line.slice(1) }); addCount++; }
    else if (line.startsWith('-')) { cur.lines.push({ kind: 'del', text: line.slice(1) }); delCount++; }
    else if (line.startsWith(' ')) { cur.lines.push({ kind: 'ctx', text: line.slice(1) }); }
  }

  return {
    path,
    status,
    ...(status === 'renamed' && oldPath !== newPath ? { oldPath } : {}),
    addCount,
    delCount,
    hunks,
  };
}

/** 构建行内文档：正文不带 diff 前缀（前缀只体现在状态栏 + 颜色）；返回每行 kind 与新文件行号（del = null）。三数组对齐。 */
export function buildInlineDoc(file: DiffFile): { doc: string; kinds: DiffLine['kind'][]; numbers: (number | null)[] } {
  const docLines: string[] = [];
  const kinds: DiffLine['kind'][] = [];
  const numbers: (number | null)[] = [];
  for (const hunk of file.hunks) {
    let newLine = hunk.newStart; // 每个 hunk 各自起编号（hunk 间有省略内容）
    for (const l of hunk.lines) {
      docLines.push(l.text);
      kinds.push(l.kind);
      if (l.kind === 'del') { numbers.push(null); continue; }
      numbers.push(newLine++); // ctx/add = 新文件行号自增
    }
  }
  return { doc: docLines.join('\n'), kinds, numbers };
}
