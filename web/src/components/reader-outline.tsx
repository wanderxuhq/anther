import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { ReaderOutlineItem, ReaderState } from '../readers/types.ts';
import { t } from '../i18n.ts';
import './reader-outline.css';

function OutlineItem(props: { item: ReaderOutlineItem; navigate: (id: string) => void }) {
  const [expanded, setExpanded] = createSignal(false);
  const title = () => props.item.title.trim() || t('reader.outlineUntitled');
  return <li>
    <div class="outline-row">
      <Show when={props.item.children.length} fallback={<span class="outline-arrow" />}>
        <button class="outline-arrow" aria-label={title()} aria-expanded={expanded()} onClick={() => setExpanded((value) => !value)}>{expanded() ? '▾' : '▸'}</button>
      </Show>
      <button class="outline-title" title={title()} disabled={!props.item.navigable && !props.item.children.length}
        onClick={() => props.item.navigable ? props.navigate(props.item.id) : setExpanded((value) => !value)}>{title()}</button>
    </div>
    <Show when={expanded()}><ul><For each={props.item.children}>{(item) => <OutlineItem item={item} navigate={props.navigate}/>}</For></ul></Show>
  </li>;
}

export function ReaderOutline(props: { id: string; state: ReaderState; navigate: (id: string) => void | Promise<void>; close: (navigated?: boolean) => void }) {
  let popup!: HTMLElement, disposed = false, navigation = 0;
  const [error, setError] = createSignal(false);
  onMount(() => popup.focus({ preventScroll: true }));
  onCleanup(() => { disposed = true; });
  const navigate = async (id: string) => {
    const request = ++navigation;
    setError(false);
    try {
      await props.navigate(id);
      if (!disposed && request === navigation) props.close(true);
    } catch { if (!disposed && request === navigation) setError(true); }
  };
  return <section ref={popup} id={props.id} class="reader-outline-popup" role="dialog" aria-label={t('reader.outline')} tabIndex={-1}>
    <div class="reader-outline-header"><h3>{t('reader.outline')}</h3>
      <button class="icon-btn" title={t('reader.closeOutline')} aria-label={t('reader.closeOutline')} onClick={() => props.close()}>×</button>
    </div>
    <nav class="outline-view" aria-label={t('reader.outline')}>
      <Show when={props.state.outlineStatus === 'loading'}><p role="status">{t('loading')}</p></Show>
      <Show when={props.state.outlineStatus === 'unavailable'}><p>{t('reader.outlineUnavailable')}</p></Show>
      <Show when={props.state.outlineStatus === 'error'}><p role="alert">{t('reader.outlineFailed')}</p></Show>
      <Show when={error()}><p role="alert">{t('reader.outlineJumpFailed')}</p></Show>
      <Show when={props.state.outlineStatus === 'ready'}>
        <Show when={props.state.outline.length} fallback={<p>{t('reader.outlineEmpty')}</p>}>
          <ul><For each={props.state.outline}>{(item) => <OutlineItem item={item} navigate={(id) => void navigate(id)}/>}</For></ul>
        </Show>
      </Show>
    </nav>
  </section>;
}
