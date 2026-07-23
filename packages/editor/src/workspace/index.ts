/**
 * Workspace module — public API.
 */

export {
  createWorkspaceSnapshot,
  getWorkspaceShortcutHint,
  matchWorkspaceShortcut,
  // Switching
  useWorkspaceSwitcher,
} from './useWorkspace';

export {
  getEffectivePanelConfig,
  isModeCustomized,
  // Persistence
  loadWorkspacePreferences,
  recoverWorkspaceConfig,
  resetAllPreferences,
  resetModePreferences,
  saveWorkspacePreferences,
  setPanelOverride,
} from './workspaceStore';
export {
  ALL_WORKSPACE_MODES,
  type CanvasOverlayConfig,
  DEPRECATED_TAB_FALLBACKS,
  getDefaultInspectorTab,
  getGroupedInspectorTabs,
  getHiddenTools,
  getOrderedPanels,
  getVisibleInspectorTabs,
  getVisibleStatusSections,
  // Helpers
  getWorkspaceConfig,
  type InspectorTabConfig,
  type InspectorTabGroup,
  type InspectorTabId,
  isValidWorkspaceConfig,
  migrateWorkspaceConfig,
  type OnboardingConfig,
  type PanelConfig,
  type PanelId,
  type PanelLayout,
  type PerformanceConfig,
  type ShortcutLayer,
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
  WORKSPACE_SHORTCUTS,
  type WorkspaceConfig,
  // Types
  type WorkspaceMode,
  type WorkspacePreference,
  type WorkspacePreferences,
  type WorkspaceSnapshot,
} from './workspaceTypes';
