import { createMemo, onMount, onCleanup } from 'solid-js';
import { renderMarkdown } from '../markdown.ts';
import { t } from '../i18n.ts';

export function MarkdownPreview(props: { content: string; path?: string; allowRelativeLinks?: boolean; onNavigator?: (navigate: ((id: string) => void) | null) => void }) {
  let viewport!: HTMLElement;
  onMount(() => props.onNavigator?.((id) => {
    const heading = [...viewport.querySelectorAll<HTMLElement>('[data-md-heading]')].find((element) => element.dataset.mdHeading === id);
    if (!heading) throw new Error('Heading unavailable');
    viewport.scrollTop += heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
    viewport.focus({ preventScroll: true });
  }));
  onCleanup(() => props.onNavigator?.(null));
  const html = createMemo(() => renderMarkdown(props.content, props.path, String(Date.now()), props.allowRelativeLinks));
  return (
    <section ref={viewport} class="markdown-preview" aria-label={t('markdown.preview')} tabIndex={0}>
      <article class="markdown-body" innerHTML={html()} />
    </section>
  );
}
