import type { JSX } from 'solid-js';

export type IconName =
  | 'plus' | 'send' | 'chevron-down' | 'chevron-right'
  | 'copy' | 'check' | 'x' | 'trash' | 'edit' | 'fork' | 'search'
  | 'menu' | 'brain' | 'file' | 'alert'
  | 'refresh' | 'sparkles' | 'arrow-down'
  | 'shield' | 'info' | 'message' | 'list' | 'puzzle' | 'terminal';

const paths: Record<IconName, () => JSX.Element> = {
  plus: () => <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  send: () => <><path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4Z" /></>,
  'chevron-down': () => <path d="m6 9 6 6 6-6" />,
  'chevron-right': () => <path d="m9 6 6 6-6 6" />,
  copy: () => <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  check: () => <path d="M20 6 9 17l-5-5" />,
  x: () => <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  trash: () => <><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6" /><path d="M14 11v6" /></>,
  edit: () => <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  fork: () => <><circle cx="6" cy="3" r="2" /><circle cx="6" cy="21" r="2" /><circle cx="18" cy="9" r="2" /><path d="M6 5v14" /><path d="M18 11v2a4 4 0 0 1-4 4H6" /></>,
  search: () => <><circle cx="11" cy="11" r="7" /><path d="m20 20-4.3-4.3" /></>,
  menu: () => <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
  brain: () => <><path d="M9.5 4A3.5 3.5 0 0 0 6 7.5 3.5 3.5 0 0 0 4.5 14 3.5 3.5 0 0 0 8 18.5 3.5 3.5 0 0 0 12 20" /><path d="M14.5 4A3.5 3.5 0 0 1 18 7.5a3.5 3.5 0 0 1 1.5 6.5 3.5 3.5 0 0 1-3.5 4.5 3.5 3.5 0 0 1-4 1.5" /><path d="M12 4v16" /><path d="M8 8h2" /><path d="M14 8h2" /><path d="M8 14h2" /><path d="M14 14h2" /></>,
  file: () => <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>,
  alert: () => <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  refresh: () => <><path d="M21 12a9 9 0 0 0-15-6.7L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 15 6.7L21 16" /><path d="M21 21v-5h-5" /></>,
  sparkles: () => <><path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9Z" /><path d="M5 3v4" /><path d="M3 5h4" /><path d="M19 17v4" /><path d="M17 19h4" /></>,
  'arrow-down': () => <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  shield: () => <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  info: () => <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  message: () => <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />,
  list: () => <><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></>,
  puzzle: () => <path d="M19.44 7.85c-.05.32.06.65.29.88l1.57 1.57c.47.47.7 1.08.7 1.7s-.23 1.23-.7 1.7l-1.61 1.61a.98.98 0 0 1-.84.28c-.47-.07-.8-.48-.97-.93a2.5 2.5 0 1 0-3.21 3.22c.44.16.85.5.92.97a.98.98 0 0 1-.27.83l-1.61 1.61c-.47.47-1.09.71-1.71.71s-1.23-.24-1.7-.71l-1.57-1.57a1.03 1.03 0 0 0-.88-.29c-.49.08-.84.51-1.02.97a2.5 2.5 0 1 1-3.23-3.24c.46-.18.89-.52.96-1.02a1.03 1.03 0 0 0-.29-.87L3.7 13.7A2.4 2.4 0 0 1 3 12c0-.62.24-1.23.71-1.7l1.53-1.53c.24-.24.58-.35.92-.3.51.08.87.53 1.07 1.01a2.5 2.5 0 1 0 3.26-3.26c-.48-.2-.93-.56-1.01-1.07-.05-.34.06-.68.3-.92l1.53-1.53c.47-.47 1.08-.7 1.7-.7s1.24.24 1.71.71l1.57 1.57c.23.23.55.34.87.29.5-.07.85-.5 1.02-.97a2.5 2.5 0 1 1 3.24 3.24c-.47.18-.9.53-.97 1.02Z" />,
  terminal: () => <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
};

export function Icon(props: { name: IconName; size?: number; class?: string; strokeWidth?: number }) {
  return (
    <svg
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.7}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      {paths[props.name]()}
    </svg>
  );
}
