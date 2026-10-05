import { createMemo, onMount, onCleanup } from 'solid-js';
import { renderMarkdown } from '../markdown.ts';
import { t } from '../i18n.ts';

export function MarkdownPreview(props: { content: string; path?: string; allowRelativeLinks?: boolean; onHeading?: (id: string) => void; onNavigator?: (navigate: ((id: string) => void) | null) => void }) {
  let viewport!: HTMLElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capture = () => {
    const headings = [...viewport.querySelectorAll<HTMLElement>('[data-md-heading]')];
    const top = viewport.getBoundingClientRect().top + 24;
    const heading = headings.filter((element) => element.getBoundingClientRect().top <= top).at(-1) ?? headings[0];
    if (heading) props.onHeading?.(heading.dataset.mdHeading!);
  };
  onMount(() => props.onNavigator?.((id) => {
    if (id === '') { viewport.scrollTop = 0; props.onHeading?.(''); return; }
    const heading = [...viewport.querySelectorAll<HTMLElement>('[data-md-heading]')].find((element) => element.dataset.mdHeading === id);
    if (!heading) throw new Error('Heading unavailable');
    viewport.scrollTop += heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
    viewport.focus({ preventScroll: true });
    props.onHeading?.(id);
  }));
  onCleanup(() => { clearTimeout(timer); props.onNavigator?.(null); });
  const html = createMemo(() => renderMarkdown(props.content, props.path, String(Date.now()), props.allowRelativeLinks));
  return (
    <section ref={viewport} class="markdown-preview" aria-label={t('markdown.preview')} tabIndex={0}
      onScroll={() => { clearTimeout(timer); timer = setTimeout(capture, 180); }}>
      <article class="markdown-body" innerHTML={html()} />
    </section>
  );
}
