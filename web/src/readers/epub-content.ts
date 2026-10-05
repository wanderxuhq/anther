import { stabilizeEpubCss } from './epub-layout.ts';
import DOMPurify from 'dompurify';
import { epubLink, type EpubBook } from './epub-data.ts';

export type EpubChapter = { html: string; release(): void };
const text = new TextDecoder();
async function replaceAsync(value: string, pattern: RegExp, replace: (match: RegExpMatchArray) => Promise<string>) {
  const matches = [...value.matchAll(pattern)], replacements: string[] = [];
  for (const match of matches) replacements.push(await replace(match));
  let index = 0;
  return value.replace(pattern, () => replacements[index++]!);
}

/** Resolve private book resources to leased URLs. No live book markup enters the app DOM. */
export async function prepareEpubChapter(book: EpubBook, index: number, read: (path: string, limit: number) => Promise<Uint8Array>): Promise<EpubChapter> {
  const item = book.spine[index];
  if (!item) throw new Error('Chapter unavailable');
  const urls = new Set<string>(), resources = new Map<string, Promise<string>>();
  let bytes = 0;
  const release = () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); };
  const load = async (path: string, limit: number) => {
    const data = await read(path, limit); bytes += data.byteLength;
    if (bytes > 64 * 1024 * 1024) throw new Error('EPUB chapter resources too large');
    return data;
  };
  const blobUrl = (data: BlobPart, mime: string) => {
    const url = URL.createObjectURL(new Blob([data], { type: mime })); urls.add(url); return url;
  };
  const resource = async (href: string, base: string, ancestors: string[] = []): Promise<string> => {
    if (urls.has(href)) return href;
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(href)) return href;
    const target = epubLink(href, base), info = target && book.manifest.get(target.path);
    if (!target || !info || book.hiddenResources.has(target.path) || ancestors.includes(target.path) || ancestors.length > 8) return '';
    if (!/^(image\/|font\/|audio\/|video\/|text\/css$|application\/(?:font|vnd.ms-opentype|x-font))/.test(info.mime)) return '';
    let pending = resources.get(target.path);
    if (!pending) {
      pending = (async () => {
        const data = await load(target.path, 32 * 1024 * 1024);
        if (info.mime === 'text/css') return blobUrl(await css(text.decode(data), target.path, [...ancestors, target.path]), 'text/css');
        return blobUrl(data as Uint8Array<ArrayBuffer>, info.mime);
      })();
      resources.set(target.path, pending);
    }
    const url = await pending;
    return url && target.fragment ? `${url}#${encodeURIComponent(target.fragment)}` : url;
  };
  const css = async (value: string, base: string, ancestors: string[] = []): Promise<string> => {
    value = await replaceAsync(value, /@import\s+(?:url\(\s*['"]?([^'"\s)]+)['"]?\s*\)|['"]([^'"]+)['"])([^;]*);/gi, async (match) => {
      const url = await resource(match[1] ?? match[2], base, ancestors);
      return url ? `@import url("${url}")${match[3]};` : '';
    });
    value = await replaceAsync(value, /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, async (match) => {
      const href = (match[1] ?? match[2] ?? match[3]).trim();
      if (href.startsWith('#')) return `url("${href.replace(/["<>]/g, '')}")`;
      return `url("${await resource(href, base, ancestors)}")`;
    });
    return stabilizeEpubCss(value);
  };
  try {
    const markup = text.decode(await load(item.path, 16 * 1024 * 1024));
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    const styles: string[] = [];
    for (const el of doc.querySelectorAll('style, link[rel~="stylesheet"]')) {
      const url = el.tagName === 'STYLE' ? blobUrl(await css(el.textContent ?? '', item.path), 'text/css') : await resource(el.getAttribute('href') ?? '', item.path);
      if (url) styles.push(url);
    }
    const clean = DOMPurify.sanitize(doc.body.innerHTML, {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'form', 'input', 'button', 'textarea', 'select', 'foreignObject', 'style', 'animate', 'set', 'animateTransform'],
      FORBID_ATTR: ['srcdoc', 'srcset', 'action', 'formaction', 'target', 'ping', 'download', 'autofocus'],
    });
    const body = new DOMParser().parseFromString(clean, 'text/html').body;
    // Preserve book-level styling without trusting body event attributes.
    for (const name of ['class', 'dir', 'lang', 'id']) if (doc.body.hasAttribute(name)) body.setAttribute(name, doc.body.getAttribute(name)!);
    if (doc.body.hasAttribute('style')) body.setAttribute('style', await css(doc.body.getAttribute('style')!, item.path));
    for (const el of body.querySelectorAll('*')) {
      el.removeAttribute('data-epub-link');
      if (el.hasAttribute('style')) el.setAttribute('style', await css(el.getAttribute('style')!, item.path));
      for (const name of ['src', 'poster', 'href', 'xlink:href']) {
        const href = el.getAttribute(name);
        if (href === null) continue;
        el.removeAttribute(name);
        if (el.localName === 'a' && name === 'href') {
          const link = epubLink(href, item.path);
          if (link && book.spine.some((item) => item.path === link.path)) { el.setAttribute('href', '#'); el.setAttribute('data-epub-link', JSON.stringify(link)); }
          else if (/^https?:\/\//i.test(href)) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
        } else if (href.startsWith('#')) el.setAttribute(name, href);
        else {
          const url = await resource(href, item.path);
          if (url) el.setAttribute(name, url);
        }
      }
      // Lazy images would prevent offscreen chapters from settling to their real height.
      if (el.localName === 'img') el.setAttribute('loading', 'eager');
    }
    // Stable content indices, assigned after sanitizing. Reader UI never enters this tree.
    const parents: Element[] = [body];
    while (parents.length) {
      const parent = parents.pop()!;
      Array.from(parent.children).forEach((child, index) => { child.setAttribute('data-lidx', String(index)); parents.push(child); });
    }
    const shell = document.implementation.createHTMLDocument(book.title);
    shell.documentElement.lang = book.language;
    shell.head.innerHTML = '';
    const policy = shell.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob:; media-src blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    shell.head.append(policy);
    const style = shell.createElement('style');
    style.textContent = ':root{color-scheme:light dark;overflow:hidden}body{margin:0;padding:24px;line-height:1.65;overflow-wrap:anywhere;color:light-dark(#222,#ddd);background:light-dark(#fff,#202020)}img,svg,video{max-width:100%;height:auto}pre{white-space:pre-wrap}a{color:light-dark(#1565c0,#8ab4f8)}';
    shell.head.append(style);
    for (const url of styles) { const link = shell.createElement('link'); link.rel = 'stylesheet'; link.href = url; shell.head.append(link); }
    shell.body.replaceWith(shell.importNode(body, true));
    return { html: '<!doctype html>' + shell.documentElement.outerHTML, release };
  } catch (error) { release(); throw error; }
}
