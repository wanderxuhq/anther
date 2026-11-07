import type { JSX } from 'solid-js';
import { FileTreeView } from './filetree.tsx';
import { TabsView } from './tabs.tsx';
import { SearchView } from './search.tsx';
import { t } from '../i18n.ts';
import type { Panel } from '../url-state.ts';
import type { IconName } from '../components/icons.tsx';

export type ViewDef = { id: Panel; icon: IconName; title: () => string; render: () => JSX.Element };

export const views: ViewDef[] = [
  { id: 'files', icon: 'files', title: () => t('view.files'), render: () => <FileTreeView /> },
  { id: 'tabs', icon: 'tabs', title: () => t('view.tabs'), render: () => <TabsView /> },
  { id: 'search', icon: 'search', title: () => t('view.search'), render: () => <SearchView /> },
];
