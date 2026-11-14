import { createMemo, createSignal } from 'solid-js';
import { tabs, currentTabId, switchTab, closeAnyTab } from '../stores.ts';
import { tabIcon, tabName, tabTitle } from '../tab-presentation.ts';
import { TabList } from '../components/tab-list.tsx';
import { Icon } from '../components/icons.tsx';
import { t } from '../i18n.ts';

export function TabsView() {
  const [query, setQuery] = createSignal('');
  const items = createMemo(() => {
    const q = query().trim().toLowerCase();
    return tabs()
      .map((tab) => ({ id: tab.id, title: tabName(tab), description: tabTitle(tab), icon: tabIcon(tab) }))
      .filter((item) => !q
        || item.title.toLowerCase().includes(q)
        || (item.description ?? '').toLowerCase().includes(q));
  });
  return <div class="tabs-view">
    <label class="tabs-search">
      <Icon name="search" size={14} />
      <input
        type="search"
        value={query()}
        placeholder={t('tabs.search')}
        aria-label={t('tabs.search')}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
    </label>
    <TabList
      items={items()}
      activeId={currentTabId()}
      onSelect={(id) => void switchTab(id)}
      onClose={(id) => void closeAnyTab(id)}
      emptyLabel={query().trim() ? t('tabs.noResults') : t('tabs.empty')}
      closeLabel={t('close')}
    />
  </div>;
}
