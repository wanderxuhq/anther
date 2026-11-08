// web/src/components/icons.tsx
// 项目统一 SVG 图标：24×24 网格、currentColor 描边、圆角端点。
// 图标只负责形状；可访问名称由外层按钮的 title/aria-label 提供。
import type { JSX } from 'solid-js';

export type IconName =
  | 'menu' | 'search' | 'close' | 'plus' | 'minus' | 'more'
  | 'chevron-right' | 'chevron-down' | 'chevron-left'
  | 'refresh' | 'info' | 'sparkles' | 'edit' | 'eye' | 'code'
  | 'download' | 'check' | 'alert' | 'undo' | 'lock'
  | 'terminal' | 'terminal-plus' | 'files' | 'file' | 'tabs' | 'instances' | 'keyboard'
  | 'git-branch' | 'git-changes' | 'git-history' | 'commit' | 'diff'
  | 'archive' | 'database' | 'table' | 'structure'
  | 'sliders' | 'fit' | 'fit-width' | 'zoom-in' | 'zoom-out' | 'actual-size'
  | 'outline' | 'copy' | 'expand' | 'collapse'
  | 'sort-asc' | 'sort-desc'
  | 'theme-auto' | 'sun' | 'moon';

type IconPath = () => JSX.Element;

const icons: Record<IconName, IconPath> = {
  menu: () => <path d="M4 7h16M4 12h16M4 17h16" />,
  search: () => <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  close: () => <path d="m6 6 12 12M18 6 6 18" />,
  plus: () => <path d="M12 5v14M5 12h14" />,
  minus: () => <path d="M5 12h14" />,
  more: () => <path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.5" />,
  'chevron-right': () => <path d="m9 6 6 6-6 6" />,
  'chevron-down': () => <path d="m6 9 6 6 6-6" />,
  'chevron-left': () => <path d="m15 6-6 6 6 6" />,
  refresh: () => <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  info: () => <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  sparkles: () => <>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
  </>,
  edit: () => <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13 7 4 4" /></>,
  eye: () => <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.75" /></>,
  code: () => <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  download: () => <path d="M12 3v11m-4-4 4 4 4-4M4 17v3h16v-3" />,
  check: () => <path d="m5 12 4 4L19 6" />,
  alert: () => <><path d="M12 4 3 20h18L12 4Z" /><path d="M12 10v4M12 17h.01" /></>,
  undo: () => <><path d="M9 7 4 12l5 5" /><path d="M4 12h9a6 6 0 0 1 6 6v1" /></>,
  lock: () => <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  terminal: () => <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
  'terminal-plus': () => <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M13 15h4M15 7v4M13 9h4" />
  </>,
  files: () => <><path d="M3 6h6l2 2h10v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" /><path d="M8 13h8M8 17h5" /></>,
  file: () => <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>,
  tabs: () => <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M8 5v4" /></>,
  instances: () => <>
    <rect x="3" y="4" width="18" height="6" rx="2" />
    <rect x="3" y="14" width="18" height="6" rx="2" />
    <path d="M7 7h.01M7 17h.01" />
  </>,
  keyboard: () => <>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 14h.01M10 14h6M18 14h.01" />
  </>,
  'git-branch': () => <>
    <circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" />
    <path d="M6 7v10M8 7h5a5 5 0 0 1 5 5v3" />
  </>,
  'git-changes': () => <path d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01" />,
  'git-history': () => <><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" /><path d="M12 7v5l3 2" /></>,
  commit: () => <><circle cx="12" cy="12" r="3" /><path d="M3 12h6M15 12h6" /></>,
  diff: () => <><path d="M7 3v18M17 3v18M7 8h4M13 16h4" /></>,
  archive: () => <><path d="M5 3h10l4 4v14H5z" /><path d="M11 3v3h2v3h-2v3h2v3h-2v3h2" /></>,
  database: () => <>
    <ellipse cx="12" cy="5" rx="7.5" ry="3" />
    <path d="M4.5 5v14c0 3 15 3 15 0V5" />
    <path d="M4.5 12c0 3 15 3 15 0" />
  </>,
  table: () => <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 9v11" /></>,
  structure: () => <>
    <path d="M6 4v16M6 8h6M6 16h6M12 8v8" />
    <circle cx="18" cy="8" r="2" /><circle cx="18" cy="16" r="2" />
  </>,
  sliders: () => <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />,
  fit: () => <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="m8 9 4 6 4-6" /></>,
  'fit-width': () => <path d="M3 5v14M21 5v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3" />,
  'zoom-in': () => <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6" /></>,
  'zoom-out': () => <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.5 10.5h6" /></>,
  'actual-size': () => <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5M9 9h6v6H9z" />,
  outline: () => <path d="M4 5h16M8 10h12M8 15h12M4 20h16M3 10h1M3 15h1" />,
  copy: () => <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  expand: () => <path d="M8 3H3v5m0-5 7 7m6 11h5v-5m0 5-7-7" />,
  collapse: () => <path d="M3 10h7V3m0 7L3 3m18 11h-7v7m0-7 7 7" />,
  'sort-asc': () => <path d="M12 19V5m-5 5 5-5 5 5" />,
  'sort-desc': () => <path d="M12 5v14m-5-5 5 5 5-5" />,
  // 圈内 A（Auto）：跟随系统主题；太阳/月亮：明确的浅色/深色。
  'theme-auto': () => <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 15.5 12 8.5l3.5 7M9.8 13.4h4.4" />
  </>,
  sun: () => <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
  moon: () => <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
};

export function Icon(props: {
  name: IconName;
  size?: number;
  class?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      {icons[props.name]()}
    </svg>
  );
}
