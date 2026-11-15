// web/src/features.ts
// Optional feature packages: flags, panel list, and lazy UI bundle loading.
import { createSignal } from 'solid-js';
import { withBase } from './base.ts';
import type { FeaturePanel, FeatureRoute, FeatureTabPatch, FeatureTabsState, FeatureToolbarAction } from './feature-types.ts';

export type FeaturePanelInfo = {
  id: string;
  title: string;
  icon: string;
  route: string;
  ui: string;
};

export type FeatureInfo = {
  id: string;
  version: string;
  panels: FeaturePanelInfo[];
};

export type FeatureFlags = Record<string, FeatureInfo>;

export type FeatureUiProps = {
  base: string;
  theme: string;
  lang: string;
  path: string;
  /** Feature-owned tabs (e.g. OpenCode sessions) rendered by anther's tab list. */
  onTabs?(state: FeatureTabsState): void;
  /** Feature-owned actions rendered by anther's main toolbar. */
  onToolbar?(actions: FeatureToolbarAction[]): void;
  /** Open or switch to one feature-owned document tab. */
  onOpenPath?(path: string, patch?: FeatureTabPatch): void;
  /** Close one feature-owned document tab. */
  onClosePath?(path: string): void;
  /** Update an already-open feature tab without changing the active tab. */
  onUpdateTab?(path: string, patch: FeatureTabPatch): void;
};
export type FeatureUiHandle = {
  dispose(): void;
  update?(patch: { theme?: string; lang?: string; path?: string }): void;
};
export type FeatureUiModule = {
  mount(el: HTMLElement, props: FeatureUiProps): FeatureUiHandle;
};

const BUILTIN_PANELS: FeaturePanel[] = [{
  featureID: 'anther',
  panelID: 'agent',
  title: 'Agent',
  icon: 'sparkles',
  route: '/_/agent',
  ui: '',
  builtin: 'agent',
}];
const [featurePanels, setFeaturePanels] = createSignal<FeaturePanel[]>(BUILTIN_PANELS);
export { featurePanels };

const uiLoads = new Map<string, Promise<FeatureUiModule>>();

export async function loadFeatures(): Promise<void> {
  try {
    const res = await fetch(withBase('/api/features'), { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return;
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const flags = data as FeatureFlags;
    const panels: FeaturePanel[] = [];
    for (const [featureID, info] of Object.entries(flags)) {
      for (const panel of info.panels ?? []) {
        panels.push({
          featureID,
          panelID: panel.id,
          title: panel.title,
          icon: panel.icon,
          route: panel.route,
          ui: panel.ui,
        });
      }
    }
    setFeaturePanels([...BUILTIN_PANELS, ...panels]);
  } catch {
    // 功能表不可用：保持空表，anther 其余功能不受影响。
  }
}

export function featureRoutes(): FeatureRoute[] {
  return featurePanels().map(({ featureID, panelID, route }) => ({ featureID, panelID, route }));
}

export function findFeaturePanel(featureID: string, panelID: string): FeaturePanel | undefined {
  return featurePanels().find((panel) => panel.featureID === featureID && panel.panelID === panelID);
}

export function loadFeatureUi(url: string): Promise<FeatureUiModule> {
  const resolved = withBase(url);
  let promise = uiLoads.get(resolved);
  if (!promise) {
    // 运行时 URL 不能被 Vite 静态分析；bundle 由功能包自己提供。
    promise = import(/* @vite-ignore */ resolved) as Promise<FeatureUiModule>;
    uiLoads.set(resolved, promise);
  }
  return promise;
}
