import type { ReaderOutlineItem } from './types.ts';

export type EpubLink = { path: string; fragment: string };
export type EpubItem = { id: string; path: string; mime: string; properties: string[] };
export type EpubBook = {
  title: string; language: string; spine: (EpubItem & { linear: boolean })[]; manifest: Map<string, EpubItem>;
  outline: ReaderOutlineItem[]; destinations: Map<string, EpubLink>; hiddenResources: Set<string>;
};
export const unsupportedEpub = () => Object.assign(new Error('Unsupported EPUB encryption or layout'), { readerError: 'unsupported' as const });
export function parseEpubXml(text: string): Document {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) throw new Error('EPUB XML declarations are not supported');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid EPUB XML');
  return doc;
}
export const elements = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
export function epubLink(reference: string, base: string): EpubLink | null {
  if (!reference || /^[a-z][\w+.-]*:|^\/\//i.test(reference)) return null;
  try {
    const url = new URL(reference, `https://epub.invalid/${base.split('/').map(encodeURIComponent).join('/')}`);
    const path = decodeURIComponent(url.pathname.slice(1));
    if (!path || /[\0\\]/.test(path)) return null;
    return { path, fragment: decodeURIComponent(url.hash.slice(1)) };
  } catch { return null; }
}

/** Package/navigation data only; the file tree and reader consume the same result. */
export async function readEpubBook(read: (path: string) => Promise<string>, paths: Set<string>): Promise<EpubBook> {
  const container = parseEpubXml(await read('META-INF/container.xml'));
  const root = elements(container, 'rootfile').find((item) => item.getAttribute('media-type') === 'application/oebps-package+xml') ?? elements(container, 'rootfile')[0];
  const packagePath = root?.getAttribute('full-path');
  if (!packagePath || !paths.has(packagePath)) throw new Error('Missing EPUB package');
  const doc = parseEpubXml(await read(packagePath));
  if (elements(doc, 'meta').some((meta) => meta.getAttribute('property') === 'rendition:layout' && meta.textContent?.trim() === 'pre-paginated')) throw unsupportedEpub();
  const manifest = new Map<string, EpubItem>(), ids = new Map<string, EpubItem>();
  for (const el of elements(doc, 'item')) {
    const link = epubLink(el.getAttribute('href') ?? '', packagePath), id = el.getAttribute('id');
    if (!id || !link) continue;
    const item = { id, path: link.path, mime: el.getAttribute('media-type') ?? '', properties: (el.getAttribute('properties') ?? '').split(/\s+/) };
    manifest.set(item.path, item); ids.set(id, item);
  }
  const spine = elements(doc, 'itemref').map((ref) => {
    if ((ref.getAttribute('properties') ?? '').includes('rendition:layout-pre-paginated')) throw unsupportedEpub();
    const item = ids.get(ref.getAttribute('idref') ?? '');
    if (!item || !paths.has(item.path) || !['application/xhtml+xml', 'text/html'].includes(item.mime)) throw unsupportedEpub();
    return { ...item, linear: ref.getAttribute('linear') !== 'no' };
  });
  if (!spine.length || spine.length > 10_000) throw new Error('Invalid EPUB spine');
  const hiddenResources = new Set<string>();
  if (paths.has('META-INF/encryption.xml')) {
    const encryption = parseEpubXml(await read('META-INF/encryption.xml'));
    for (const item of elements(encryption, 'EncryptedData')) {
      const algorithm = elements(item, 'EncryptionMethod')[0]?.getAttribute('Algorithm');
      if (!['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'].includes(algorithm ?? '')) throw unsupportedEpub();
      const uri = elements(item, 'CipherReference')[0]?.getAttribute('URI');
      const link = uri && epubLink(uri, '');
      if (link) hiddenResources.add(link.path); // Obfuscated fonts fall back to the browser's fonts.
    }
  }
  const book: EpubBook = { title: elements(doc, 'title')[0]?.textContent?.trim() ?? '', language: elements(doc, 'language')[0]?.textContent?.trim() ?? '', spine, manifest, outline: [], destinations: new Map(), hiddenResources };
  let nextOutlineId = 0;
  const add = (title: string, href: string, base: string, children: ReaderOutlineItem[]): ReaderOutlineItem => {
    const id = String(nextOutlineId++), link = epubLink(href, base);
    const navigable = !!link && spine.some((item) => item.path === link.path);
    if (link) book.destinations.set(id, link);
    return { id, title: title.trim(), navigable, children };
  };
  const nav = [...manifest.values()].find((item) => item.properties.includes('nav'));
  const ncx = ids.get(elements(doc, 'spine')[0]?.getAttribute('toc') ?? '') ?? [...manifest.values()].find((item) => item.mime === 'application/x-dtbncx+xml');
  if (nav) {
    const navigation = parseEpubXml(await read(nav.path));
    const toc = elements(navigation, 'nav').find((el) => (el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? el.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc'));
    const parseList = (list?: Element): ReaderOutlineItem[] => Array.from(list?.children ?? []).filter((el) => el.localName === 'li').map((li) => {
      const label = Array.from(li.children).find((el) => ['a', 'span'].includes(el.localName));
      return add(label?.textContent ?? '', label?.getAttribute('href') ?? '', nav.path, parseList(Array.from(li.children).find((el) => el.localName === 'ol')));
    });
    book.outline = parseList(toc && Array.from(toc.children).find((el) => el.localName === 'ol'));
  } else if (ncx) {
    const navigation = parseEpubXml(await read(ncx.path));
    const parsePoints = (parent?: Element): ReaderOutlineItem[] => Array.from(parent?.children ?? []).filter((el) => el.localName === 'navPoint').map((point) =>
      add(elements(point, 'navLabel')[0]?.textContent ?? '', elements(point, 'content')[0]?.getAttribute('src') ?? '', ncx.path, parsePoints(point)));
    book.outline = parsePoints(elements(navigation, 'navMap')[0]);
  }
  if (!book.outline.length) book.outline = spine.flatMap((item, index) => item.linear ? [add(item.id || String(index + 1), item.path.split('/').map(encodeURIComponent).join('/'), '', [])] : []);
  return book;
}
