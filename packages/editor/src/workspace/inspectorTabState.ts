import {
  getDefaultInspectorTab,
  type InspectorTabId,
  type WorkspaceConfig,
  type WorkspaceMode,
} from './workspaceTypes';

export type WorkspaceInspectorTabState = Partial<Record<WorkspaceMode, InspectorTabId>>;

function isVisibleTab(config: WorkspaceConfig, id: unknown): id is InspectorTabId {
  return config.inspectorTabs.some((tab) => tab.id === id && tab.visible);
}

/**
 * Migrate the old panel-wide active tab into the workspace active at first
 * mount. Email is deliberately initialized from its own configured default:
 * the former shared tab value was commonly left on Design while switching.
 */
export function initializeWorkspaceInspectorTabs(
  mode: WorkspaceMode,
  config: WorkspaceConfig,
  legacyActiveTab?: unknown,
): WorkspaceInspectorTabState {
  const defaultTab = getDefaultInspectorTab(mode, config);
  const canMigrateLegacy = mode !== 'email' && isVisibleTab(config, legacyActiveTab);
  return { [mode]: canMigrateLegacy ? legacyActiveTab : defaultTab };
}

/** Resolve a workspace's tab, falling back safely when it is hidden or absent. */
export function getWorkspaceInspectorTab(
  mode: WorkspaceMode,
  config: WorkspaceConfig,
  state: WorkspaceInspectorTabState,
): InspectorTabId {
  const active = state[mode];
  return isVisibleTab(config, active) ? active : getDefaultInspectorTab(mode, config);
}

/** Record a tab choice only for the workspace in which it was made. */
export function setWorkspaceInspectorTab(
  state: WorkspaceInspectorTabState,
  mode: WorkspaceMode,
  tab: InspectorTabId,
): WorkspaceInspectorTabState {
  return { ...state, [mode]: tab };
}
