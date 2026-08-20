/**
 * Workspace module — public API.
 *
 * Switching is NOT exported here. There is exactly one switch path,
 * `requestWorkspaceSwitch` on the editor context (see
 * `context/useWorkspaceMode.ts`); it owns interaction resolution, re-entrancy
 * guarding, and the announcement contract. A second entry point in this
 * barrel is what previously let a caller patch workspace state without any
 * of that, so it stays out on purpose.
 */

export { useEffectiveWorkspaceConfig } from './useWorkspaceConfig';
export { workspaceShortcutLabel } from './workspaceShortcutLabel';
export {
  // Effective configuration — the one resolver (built-in + user overrides)
  getEffectivePanelConfig,
  getEffectiveWorkspaceConfig,
  getPanelWidths,
  getWorkspacePreferences,
  isModeCustomized,
  // Persistence
  loadWorkspacePreferences,
  recoverWorkspaceConfig,
  resetAllPreferences,
  resetModePreferences,
  savePanelWidths,
  saveWorkspacePreferences,
  setInspectorTabOverride,
  setPanelOverride,
  setStatusSectionOverride,
  setToolbarToolOverride,
  subscribeWorkspacePreferences,
} from './workspaceStore';
export {
  ALL_WORKSPACE_MODES,
  type CanvasOverlayConfig,
  DEPRECATED_TAB_FALLBACKS,
  getDefaultInspectorTab,
  getGroupedInspectorTabs,
  getHiddenTools,
  getToolbarToolIds,
  getVisibleInspectorTabs,
  getVisibleStatusSections,
  getVisibleToolbarToolIds,
  // Helpers
  getWorkspaceConfig,
  type InspectorTabConfig,
  type InspectorTabGroup,
  type InspectorTabId,
  isToolVisibleInWorkspace,
  isValidWorkspaceConfig,
  migrateWorkspaceConfig,
  type OnboardingConfig,
  type PanelConfig,
  type PanelId,
  type PanelLayout,
  resolveWorkspaceTool,
  type StatusSectionConfig,
  type StatusSectionId,
  TAB_GROUP_LABELS,
  TAB_GROUP_ORDER,
  type ToolbarConfig,
  type ToolbarItem,
  WORKSPACE_CONFIG_VERSION,
  // Constants
  WORKSPACE_CONFIGS,
  WORKSPACE_ICONS,
  WORKSPACE_LABELS,
  type WorkspaceConfig,
  // Types
  type WorkspaceMode,
  type WorkspacePreference,
  type WorkspacePreferences,
} from './workspaceTypes';
