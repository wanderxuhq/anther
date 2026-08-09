import type { JSX } from 'solid-js';
import { FileTreeView } from './filetree.tsx';
import { TabsView } from './tabs.tsx';
import { SearchView } from './search.tsx';
import { t } from '../i18n.ts';

export type ViewDef = { id: string; icon: string; title: () => string; render: () => JSX.Element };

export const views: ViewDef[] = [
  { id: 'filetree', icon: '🗂', title: () => t('view.files'), render: () => <FileTreeView /> },
  { id: 'tabs', icon: '📑', title: () => t('view.tabs'), render: () => <TabsView /> },
  { id: 'search', icon: '🔍', title: () => t('view.search'), render: () => <SearchView /> },
];
