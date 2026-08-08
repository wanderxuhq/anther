// web/src/views/tabs.tsx
// 标签列表视图：纵向列出已打开文件；当前文件高亮、点击切换（openTab）、行尾 × 关闭（closeTab）。
// 服务器同步与 URL 更新由 stores.ts 的 openTab/closeTab 内部完成，视图层只做调用。
import { For, Show } from 'solid-js';
import { tabs, currentFile, openTab, closeTab } from '../stores.ts';

export function TabsView() {
  return (
    <div class="tabs-view">
      <Show when={tabs().length === 0} fallback={
        <ul class="tab-list">
          <For each={tabs()}>
            {(t) => (
              <li class={`tab-row ${currentFile() === t ? 'active' : ''}`}>
                <span
                  class="tab-name"
                  onClick={() => void openTab(t)}
                  title={t}
                >
                  {t.split('/').pop()}
                </span>
                <button class="tab-close" onClick={() => void closeTab(t)} title="关闭">
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      }>
        <div class="view-placeholder">暂无标签，从文件树打开文件</div>
      </Show>
    </div>
  );
}
