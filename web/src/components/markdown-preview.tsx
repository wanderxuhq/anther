import { createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { extractMarkdownBlock, extractMarkdownSection, isMarkdownFile, renderMarkdown } from '../markdown.ts';
import { api } from '../api.ts';
import { t } from '../i18n.ts';
import DOMPurify from 'dompurify';

let pendingBlock: { path: string; block: string } | null = null;
let mermaidRenderId = 0;

/** Queue a block-relative scroll for the next preview mount at `path`. */
export function queueObsidianBlockNavigation(path: string, block: string): void {
  pendingBlock = path && block ? { path, block } : null;
}

type ObsidianLink = { target: string; from?: string };

export function MarkdownPreview(props: { content: string; path?: string; allowRelativeLinks?: boolean; obsidian?: boolean; onObsidianLink?: (target: string, from?: string) => void; onObsidianTag?: (tag: string) => void; onHeading?: (id: string) => void; onNavigator?: (navigate: ((id: string) => void) | null) => void }) {
  let viewport!: HTMLElement;
  let article!: HTMLElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hydrationGeneration = 0;
  const capture = () => {
    const headings = [...viewport.querySelectorAll<HTMLElement>('[data-md-heading]')];
    const top = viewport.getBoundingClientRect().top + 24;
    const heading = headings.filter((element) => element.getBoundingClientRect().top <= top).at(-1) ?? headings[0];
    if (heading) props.onHeading?.(heading.dataset.mdHeading!);
  };
  onMount(() => {
    props.onNavigator?.((id) => {
      if (id === '') { viewport.scrollTop = 0; props.onHeading?.(''); return; }
      const heading = [...viewport.querySelectorAll<HTMLElement>('[data-md-heading]')].find((element) => element.dataset.mdHeading === id);
      if (!heading) throw new Error('Heading unavailable');
      viewport.scrollTop += heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
      viewport.focus({ preventScroll: true });
      props.onHeading?.(id);
    });
    const pending = pendingBlock;
    if (pending && pending.path === props.path) {
      pendingBlock = null;
      queueMicrotask(() => {
        const element = viewport.querySelector<HTMLElement>(`[id="^${pending.block}"]`);
        element?.scrollIntoView?.({ block: 'center' });
      });
    }
  });
  onCleanup(() => { clearTimeout(timer); hydrationGeneration++; props.onNavigator?.(null); });
  const html = createMemo(() => renderMarkdown(
    props.content,
    props.path,
    String(Date.now()),
    props.allowRelativeLinks,
    props.obsidian === true,
  ));
  const fromFor = (element: Element): string | undefined =>
    element.closest<HTMLElement>('[data-obsidian-from]')?.dataset.obsidianFrom || undefined;
  const tagTarget = (event: Event): string | null => {
    const node = event.target as Node | null;
    const element = node instanceof Element ? node.closest<HTMLElement>('[data-obsidian-tag]') : null;
    return element?.dataset.obsidianTag ?? null;
  };
  const spanTarget = (event: Event): ObsidianLink | null => {
    const node = event.target as Node | null;
    const element = node instanceof Element ? node.closest<HTMLElement>('[data-obsidian-link]') : null;
    const target = element?.dataset.obsidianLink;
    return target ? { target, from: fromFor(element!) } : null;
  };
  const linkTarget = (event: Event): ObsidianLink | null => {
    if (!props.obsidian || !props.onObsidianLink) return null;
    const node = event.target as Node | null;
    const anchor = node instanceof Element ? node.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || anchor.hasAttribute('download')) return null;
    const href = anchor.getAttribute('href') ?? '';
    // External protocols, protocol-relative URLs and anther API routes keep browser behavior.
    if (!href || href === '#' || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/api\/)/i.test(href)) return null;
    // Markdown-format links are URL-encoded; wikilinks keep literal spaces.
    const hash = href.indexOf('#');
    const pathPart = hash >= 0 ? href.slice(0, hash) : href;
    const suffix = hash >= 0 ? href.slice(hash + 1) : '';
    try {
      return {
        target: decodeURIComponent(pathPart) + (hash >= 0 ? `#${decodeURIComponent(suffix)}` : ''),
        from: fromFor(anchor),
      };
    } catch {
      return { target: href, from: fromFor(anchor) };
    }
  };
  const hydrateEmbeds = async (
    root: HTMLElement,
    from: string,
    depth: number,
    visited: Set<string>,
    current: () => boolean,
  ): Promise<void> => {
    const placeholders = [...root.querySelectorAll<HTMLElement>('[data-obsidian-embed]')];
    for (const placeholder of placeholders) {
      if (!current()) return;
      const target = placeholder.dataset.obsidianEmbed;
      if (!target) continue;
      let resolved;
      try { resolved = await api.obsidianResolve(target, from); }
      catch { continue; }
      if (!current()) return;
      if (!resolved.path || !isMarkdownFile(resolved.path)) continue;
      if (depth >= 3 || visited.has(resolved.path)) continue;
      try {
        const { content, utf8 } = await api.readFile(resolved.path);
        if (!current()) return;
        if (!utf8) continue;
        const section = resolved.heading
          ? extractMarkdownSection(content, resolved.heading)
          : resolved.block
            ? extractMarkdownBlock(content, resolved.block)
            : content;
        if (section === null) continue;
        const inner = renderMarkdown(section, resolved.path, String(Date.now()), true, true, false);
        const wrapper = document.createElement('div');
        wrapper.className = 'obsidian-embed-content';
        wrapper.dataset.obsidianFrom = resolved.path;
        wrapper.innerHTML = inner;
        placeholder.replaceWith(wrapper);
        await hydrateEmbeds(wrapper, resolved.path, depth + 1, new Set([...visited, resolved.path]), current);
      } catch { /* Keep the fallback link. */ }
    }
  };
  const hydrateMath = async (root: HTMLElement, current: () => boolean): Promise<void> => {
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-math]')];
    if (nodes.length === 0) return;
    let createMathJaxRenderer: typeof import('../mathjax.ts').createMathJaxRenderer;
    try { ({ createMathJaxRenderer } = await import('../mathjax.ts')); }
    catch { return; }
    if (!current()) return;
    const renderMathJax = createMathJaxRenderer();
    for (const node of nodes) {
      if (!current()) return;
      if (node.dataset.mathReady === '1') continue;
      const display = node.dataset.mathDisplay === '1';
      try {
        const tex = decodeURIComponent(node.dataset.math ?? '');
        const { markup, style } = renderMathJax(tex, display);
        const clean = DOMPurify.sanitize(markup, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ['use'],
          ADD_ATTR: ['role', 'focusable'],
          FORBID_TAGS: ['script', 'style'],
          FORBID_ATTR: ['style'],
        });
        node.innerHTML = clean;
        const svg = node.querySelector('svg');
        if (svg && /^vertical-align:\s*-?[\d.]+(?:ex|em|pt|px);?$/.test(style)) {
          svg.setAttribute('style', style);
        }
        for (const use of node.querySelectorAll('use')) {
          const href = use.getAttribute('xlink:href')
            ?? use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
            ?? use.getAttribute('href') ?? '';
          if (!href.startsWith('#')) use.remove();
        }
        node.dataset.mathReady = '1';
        if (display) node.classList.add('obsidian-math-rendered');
      } catch {
        node.dataset.mathError = '1';
      }
    }
  };
  const hydrateMermaid = async (root: HTMLElement, current: () => boolean): Promise<void> => {
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-mermaid]')];
    if (nodes.length === 0) return;
    let mermaid: typeof import('mermaid').default;
    try { ({ default: mermaid } = await import('mermaid')); }
    catch { return; }
    if (!current()) return;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
    });
    for (const node of nodes) {
      if (!current()) return;
      if (node.dataset.mermaidReady === '1') continue;
      try {
        const source = decodeURIComponent(node.dataset.mermaid ?? '');
        const { svg } = await mermaid.render(`anther-mermaid-${++mermaidRenderId}`, source);
        if (!current()) return;
        node.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ['style', 'foreignObject'],
          FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
        });
        node.dataset.mermaidReady = '1';
        node.classList.add('obsidian-mermaid-rendered');
      } catch { /* Keep the code-block fallback. */ }
    }
  };
  createEffect(() => {
    html();
    if (props.obsidian !== true || !article) return;
    const generation = ++hydrationGeneration;
    const from = props.path ?? '';
    queueMicrotask(() => {
      if (generation !== hydrationGeneration || !article) return;
      void (async () => {
        if (props.allowRelativeLinks !== false) {
          await hydrateEmbeds(article, from, 0, new Set(from ? [from] : []), () => generation === hydrationGeneration);
        }
        if (generation !== hydrationGeneration) return;
        await hydrateMath(article, () => generation === hydrationGeneration);
        if (generation !== hydrationGeneration) return;
        await hydrateMermaid(article, () => generation === hydrationGeneration);
      })();
    });
  });
  return (
    <section ref={viewport} class="markdown-preview" aria-label={t('markdown.preview')} tabIndex={0}
      onScroll={() => { clearTimeout(timer); timer = setTimeout(capture, 180); }}
      onClick={(event) => {
        const tag = tagTarget(event);
        if (tag && props.onObsidianTag) {
          event.preventDefault();
          props.onObsidianTag(tag);
          return;
        }
        const target = spanTarget(event) ?? linkTarget(event);
        if (!target || !props.onObsidianLink) return;
        event.preventDefault();
        props.onObsidianLink(target.target, target.from);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const tag = tagTarget(event);
        if (tag && props.onObsidianTag) {
          event.preventDefault();
          props.onObsidianTag(tag);
          return;
        }
        const target = spanTarget(event);
        if (!target || !props.onObsidianLink) return;
        event.preventDefault();
        props.onObsidianLink(target.target, target.from);
      }}>
      <article ref={article} class="markdown-body" innerHTML={html()} />
    </section>
  );
}
