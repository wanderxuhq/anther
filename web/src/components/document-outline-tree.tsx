import { createSignal, For, Show } from 'solid-js';
import type { OutlineState } from '../readers/outline-source.ts';
import type { ReaderOutlineItem } from '../readers/types.ts';
import { t } from '../i18n.ts';
import { Icon } from './icons.tsx';
import './document-outline-tree.css';

function Branch(props: { items: ReaderOutlineItem[]; navigate(id: string): void; selected?: string }) {
  const [limit, setLimit] = createSignal(100);
  return <><For each={props.items.slice(0, limit())}>{(item) => {
    const [expanded, setExpanded] = createSignal(false);
    const title = () => item.title.trim() || t('reader.outlineUntitled');
    return <div class="tree-node">
      <div class="tree-row document-outline-row" classList={{ active: props.selected === item.id }}>
        <span class="tree-arrow"><Show when={item.children.length}>
          <button class="archive-toggle" title={title()} aria-label={title()} aria-expanded={expanded()} onClick={() => setExpanded(!expanded())}><Icon name={expanded() ? 'chevron-down' : 'chevron-right'} size={14} /></button>
        </Show></span>
        <button class="tree-name document-outline-title" title={title()} disabled={!item.navigable && !item.children.length}
          aria-current={props.selected === item.id ? 'location' : undefined}
          onClick={() => item.navigable ? props.navigate(item.id) : setExpanded(!expanded())}>{title()}</button>
      </div>
      <Show when={expanded()}><div class="tree-children"><Branch items={item.children} navigate={props.navigate} selected={props.selected}/></div></Show>
    </div>;
  }}</For>
    <Show when={props.items.length > limit()}><button class="menu-item" onClick={() => setLimit(limit() + 100)}>{t('reader.outlineMore')}</button></Show>
  </>;
}

/** Pure outline tree. Loading, document opening, and format adapters belong to its caller. */
export function DocumentOutlineTree(props: { state: OutlineState; navigate(id: string): void; open(): void; retry(): void; selected?: string; error?: boolean }) {
  return <nav class="tree-children document-outline-tree" aria-label={t('reader.outline')}>
    <Show when={props.state.password} fallback={<>
      <Show when={props.state.outlineStatus === 'loading'}><div class="document-outline-message" role="status">{t('loading')}</div></Show>
      <Show when={props.state.outlineStatus === 'error'}><div class="document-outline-message" role="alert">{t('reader.outlineFailed')} <button class="link-btn" onClick={props.retry}>{t('reader.outlineRetry')}</button></div></Show>
      <Show when={props.state.outlineStatus === 'unavailable'}><div class="document-outline-message">{t('reader.outlineUnavailable')}</div></Show>
      <Show when={props.state.outlineStatus === 'ready' && !props.state.outline.length}><div class="document-outline-message">{t('reader.outlineEmpty')}</div></Show>
    </>}><button class="menu-item" onClick={props.open}>{t('reader.outlineUnlock')}</button></Show>
    <Show when={props.error}><div class="document-outline-message" role="alert">{t('reader.outlineJumpFailed')}</div></Show>
    <Branch items={props.state.outline} navigate={props.navigate} selected={props.selected}/>
  </nav>;
}
