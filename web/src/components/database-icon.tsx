import { Show } from 'solid-js';
export function DatabaseIcon(props: { kind?: 'table' | 'view' | 'database' | 'structure' | 'refresh' }) {
  return <svg class="database-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <Show when={!props.kind || props.kind === 'database'}><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></Show>
    <Show when={props.kind === 'table'}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 9v12"/></Show>
    <Show when={props.kind === 'view'}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></Show>
    <Show when={props.kind === 'structure'}><path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/></Show>
    <Show when={props.kind === 'refresh'}><path d="M20 7A9 9 0 1 0 21 14M20 3v5h-5"/></Show>
  </svg>;
}
