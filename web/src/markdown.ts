import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function isMarkdownFile(path: string | null): boolean {
  return path !== null && /\.(md|markdown|mdown|mkdn|mkd)$/i.test(path);
}

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form'],
    FORBID_ATTR: ['style'],
  });
}
