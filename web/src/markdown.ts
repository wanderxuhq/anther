import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { resolveImageSource } from './image.ts';

export function isMarkdownFile(path: string | null): boolean {
  return path !== null && /\.(md|markdown|mdown|mkdn|mkd)$/i.test(path);
}

export function renderMarkdown(source: string, documentPath?: string, imageVersion?: string, allowRelativeLinks = true): string {
  const body = DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form'],
    FORBID_ATTR: ['style'],
    RETURN_DOM: true,
  }) as HTMLElement;
  // Virtual archive paths must never resolve to unrelated workspace files.
  if (!allowRelativeLinks) for (const element of body.querySelectorAll('img[src],a[href]')) {
    const attribute = element.tagName === 'IMG' ? 'src' : 'href';
    if (!/^(?:https?:|data:|#)/i.test(element.getAttribute(attribute) ?? '')) element.removeAttribute(attribute);
  }
  if (allowRelativeLinks && documentPath) for (const img of body.querySelectorAll('img[src]')) {
    img.setAttribute('src', resolveImageSource(img.getAttribute('src')!, documentPath, imageVersion));
  }
  return body.innerHTML;
}
