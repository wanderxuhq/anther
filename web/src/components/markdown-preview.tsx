import { createMemo } from 'solid-js';
import { renderMarkdown } from '../markdown.ts';
import { t } from '../i18n.ts';

export function MarkdownPreview(props: { content: string }) {
  const html = createMemo(() => renderMarkdown(props.content));
  return (
    <section class="markdown-preview" aria-label={t('markdown.preview')} tabIndex={0}>
      <article class="markdown-body" innerHTML={html()} />
    </section>
  );
}
