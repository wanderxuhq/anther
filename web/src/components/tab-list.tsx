import { For, Show } from 'solid-js';
import { Icon, type IconName } from './icons.tsx';

/** Content-neutral tab list. Identity and lifecycle belong to the caller. */
export function TabList(props: {
  items: { id: string; title: string; description?: string; icon?: IconName }[];
  activeId: string | null;
  onSelect(id: string): void;
  onClose(id: string): void;
  emptyLabel: string;
  closeLabel: string;
}) {
  return <Show when={props.items.length} fallback={<div class="view-placeholder">{props.emptyLabel}</div>}>
    <ul class="tab-list"><For each={props.items}>{(tab) =>
      <li class={`tab-row ${props.activeId === tab.id ? 'active' : ''}`}>
        <span class="tab-icon" aria-hidden="true"><Show when={tab.icon}>{(icon) => <Icon name={icon()} size={16} />}</Show></span>
        <button class="tab-name tab-select" onClick={() => props.onSelect(tab.id)} title={tab.description}
          aria-current={props.activeId === tab.id ? 'page' : undefined}>{tab.title}</button>
        <button class="tab-close" onClick={() => props.onClose(tab.id)} title={props.closeLabel} aria-label={`${props.closeLabel}: ${tab.title}`}><Icon name="close" size={14} /></button>
      </li>
    }</For></ul>
  </Show>;
}
