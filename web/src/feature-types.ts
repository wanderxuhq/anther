// web/src/feature-types.ts
// Pure types shared by URL state, stores and the generic feature canvas.
export type FeatureRoute = {
  featureID: string;
  panelID: string;
  /** Top-level route, e.g. /_/example. */
  route: string;
};

export type FeaturePanel = FeatureRoute & {
  title: string;
  icon: string;
  /** Runtime ESM bundle URL, e.g. /_/example/ui.js. */
  ui: string;
  /** Statically integrated core panel, e.g. the built-in ACP agent. */
  builtin?: 'agent';
};

/** One feature-owned tab, e.g. one OpenCode session. */
export type FeatureTabSpec = {
  /** Stable identity within the panel; also the value used by activeKey. */
  key: string;
  title: string;
  /** URL subpath below the panel route, e.g. "/ses_123". */
  path: string;
  /** anther icon name. */
  icon?: string;
};

export type FeatureTabsState = {
  tabs: readonly FeatureTabSpec[];
  activeKey?: string | null;
};

/** An action contributed to anther's main toolbar while this feature is active. */
export type FeatureToolbarAction = {
  id: string;
  title: string;
  /** anther icon name. */
  icon: string;
  disabled?: boolean;
  danger?: boolean;
  onClick(): void;
};

/** Presentation patch for a feature-owned document tab. */
export type FeatureTabPatch = {
  title?: string;
  icon?: string;
};
