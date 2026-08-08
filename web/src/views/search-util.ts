// web/src/views/search-util.ts
// splitByQuery 纯函数（SearchView 高亮用）。独立成 .ts 文件：
// npm test 用 node --experimental-transform-types 跑 web/src/**/*.test.ts，
// node 不识别 .tsx 扩展名也不编译 JSX，测试须从 .ts 模块导入。

/** 行文本按关键词切分为 [普通, 匹配] 交替段（大小写由 caseSensitive 决定；
 *  匹配段保留原文大小写）。纯函数，独立可测。 */
export function splitByQuery(text: string, q: string, caseSensitive: boolean): { text: string; match: boolean }[] {
  const needle = q.trim();
  if (!needle) return [{ text, match: false }];
  const hay = caseSensitive ? text : text.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  const out: { text: string; match: boolean }[] = [];
  let offset = 0;
  for (;;) {
    const idx = hay.indexOf(n, offset);
    if (idx < 0) {
      if (offset < text.length) out.push({ text: text.slice(offset), match: false });
      break;
    }
    if (idx > offset) out.push({ text: text.slice(offset, idx), match: false });
    out.push({ text: text.slice(idx, idx + needle.length), match: true });
    offset = idx + needle.length;
  }
  return out;
}
