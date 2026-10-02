import { tabs, currentTabId, switchTab, closeAnyTab } from '../stores.ts';
import { tabIcon, tabName, tabTitle } from '../tab-presentation.ts';
import { TabList } from '../components/tab-list.tsx';
import { t } from '../i18n.ts';

export function TabsView() {
  return <div class="tabs-view"><TabList
    items={tabs().map((tab) => ({ id: tab.id, title: tabName(tab), description: tabTitle(tab), icon: tabIcon(tab) }))}
    activeId={currentTabId()} onSelect={(id) => void switchTab(id)} onClose={(id) => void closeAnyTab(id)}
    emptyLabel={t('tabs.empty')} closeLabel={t('close')}
  /></div>;
}
