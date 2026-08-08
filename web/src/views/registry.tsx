import type { JSX } from 'solid-js';
import { FileTreeView } from './filetree.tsx';
import { TabsView } from './tabs.tsx';
import { SearchView } from './search.tsx';

export type ViewDef = { id: string; icon: string; title: string; render: () => JSX.Element };

export const views: ViewDef[] = [
  { id: 'filetree', icon: '🗂', title: '文件', render: () => <FileTreeView /> },
  { id: 'tabs', icon: '📑', title: '标签', render: () => <TabsView /> },
  { id: 'search', icon: '🔍', title: '搜索', render: () => <SearchView /> },
];
