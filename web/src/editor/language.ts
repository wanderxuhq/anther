// web/src/editor/language.ts
// 路径 → CodeMirror 语言解析器。与编辑器适配层分离：纯函数便于 node --test 直测。
// 匹配语义对齐 language-data 官方示例：扩展名优先（find 首个命中，lezer 条目在前、
// legacy 在后，故常用语言自动取高质量解析器），filename 正则兜底。
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';

/** 路径 → 语言描述；未命中返回 null。纯同步，不触发动态 import。 */
export function describeLanguage(path: string): LanguageDescription | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''; // 点开头文件（.gitignore）dot=0 → 空
  return (
    languages.find((desc) => {
      if (ext && desc.extensions.includes(ext)) return true;
      if (desc.filename && desc.filename.test(base)) return true;
      return false;
    }) ?? null
  );
}

/** 加载语言解析器（动态 import）；失败静默降级纯文本（高亮是锦上添花）。 */
export async function loadLanguage(desc: LanguageDescription): Promise<Extension | null> {
  try {
    const support = await desc.load();
    return support.extension;
  } catch {
    return null;
  }
}
