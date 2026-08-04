/**
 * Workspace preference persistence — localStorage-backed storage for
 * mode-specific panel overrides, customizations, and layout state.
 *
 * Handles safe migration from older config versions and invalid-layout recovery.
 */

import {
  ALL_WORKSPACE_MODES,
  getWorkspaceConfig,
  isValidWorkspaceConfig,
  migrateWorkspaceConfig,
  type PanelConfig,
  type PanelId,
  WORKSPACE_CONFIG_VERSION,
  type WorkspaceConfig,
  type WorkspaceMode,
  type WorkspacePreference,
  type WorkspacePreferences,
} from './workspaceTypes';

const STORAGE_KEY = 'varve-workspace-preferences';
const LEGACY_STORAGE_KEY = 'strata-workspace-preferences';

/** Default preference for a mode (no customizations). */
function defaultPreference(): WorkspacePreference {
  return { customized: false };
}

/** Load all workspace preferences from localStorage. */
export function loadWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return createDefaultPreferences();

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return createDefaultPreferences();

    const result: WorkspacePreferences = {} as WorkspacePreferences;
    for (const mode of ALL_WORKSPACE_MODES) {
      const entry = parsed[mode];
      if (entry && typeof entry === 'object') {
        result[mode] = entry as WorkspacePreference;
      } else {
        result[mode] = defaultPreference();
      }
    }
    return result;
  } catch {
    return createDefaultPreferences();
  }
}

/** Save workspace preferences to localStorage. */
export function saveWorkspacePreferences(prefs: WorkspacePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or unavailable — silently fail
  }
}

/** Create default (uncustomized) preferences for all modes. */
function createDefaultPreferences(): WorkspacePreferences {
  const prefs = {} as WorkspacePreferences;
  for (const mode of ALL_WORKSPACE_MODES) {
    prefs[mode] = defaultPreference();
  }
  return prefs;
}

/** Get the effective panel config for a mode, merging overrides. */
export function getEffectivePanelConfig(
  mode: WorkspaceMode,
  prefs: WorkspacePreferences,
  panelId: PanelId,
): PanelConfig {
  const base = getWorkspaceConfig(mode).panels[panelId];
  const override = prefs[mode]?.panelOverrides?.[panelId];
  if (override) {
    return { ...base, ...override };
  }
  return base;
}

/** Record a panel customization for a mode. */
export function setPanelOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  panelId: PanelId,
  override: Partial<PanelConfig>,
): WorkspacePreferences {
  const updated = { ...prefs };
  const modePrefs = { ...updated[mode] };
  const panelOverrides = { ...(modePrefs.panelOverrides ?? {}) };
  panelOverrides[panelId] = { ...(panelOverrides[panelId] ?? {}), ...override };
  modePrefs.panelOverrides = panelOverrides;
  modePrefs.customized = true;
  modePrefs.lastCustomized = Date.now();
  updated[mode] = modePrefs;
  return updated;
}

/** Reset a mode's preferences to defaults. */
export function resetModePreferences(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
): WorkspacePreferences {
  const updated = { ...prefs };
  updated[mode] = defaultPreference();
  return updated;
}

/** Reset all workspace preferences to defaults. */
export function resetAllPreferences(): WorkspacePreferences {
  return createDefaultPreferences();
}

/** Check if a mode has been customized by the user. */
export function isModeCustomized(prefs: WorkspacePreferences, mode: WorkspaceMode): boolean {
  return prefs[mode]?.customized === true;
}

/**
 * Validate and recover a workspace config.
 * Returns the recovered config or the default config if unrecoverable.
 */
export function recoverWorkspaceConfig(
  config: Record<string, unknown>,
  mode: WorkspaceMode,
): WorkspaceConfig {
  // Try migration first
  try {
    const migrated = migrateWorkspaceConfig(config);
    if (isValidWorkspaceConfig(migrated)) return migrated;
  } catch {
    // Migration failed
  }

  // Try direct validation
  if (isValidWorkspaceConfig(config)) {
    return config as unknown as WorkspaceConfig;
  }

  // Fall back to built-in default
  return getWorkspaceConfig(mode);
}

/** Version for safe migration checking. */
export { WORKSPACE_CONFIG_VERSION };
