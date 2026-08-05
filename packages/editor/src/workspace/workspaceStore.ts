/**
 * Workspace preference persistence — localStorage-backed storage for
 * mode-specific panel overrides, customizations, and layout state.
 *
 * Handles safe migration from older config versions and invalid-layout recovery.
 *
 * This store was previously dead code (defined but never loaded, applied, or
 * saved anywhere). It is now the source of truth for per-mode panel
 * customizations:
 *
 * - `useWorkspaceMode` applies effective panel config (base + overrides) on
 *   switch and on reset.
 * - panel toggles (toggleLeftPanel, toggleRightPanel, …) record overrides for
 *   the active mode.
 * - `getEffectiveWorkspaceConfig` feeds Shell (statusBar/tabStrip/pagenav).
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
        result[mode] = sanitizePreference(entry as WorkspacePreference, mode);
      } else {
        result[mode] = defaultPreference();
      }
    }
    return result;
  } catch {
    return createDefaultPreferences();
  }
}

/**
 * Sanitize a stored preference: drop panel overrides that reference unknown
 * panel ids or non-boolean/non-numeric fields, so corrupted JSON can never
 * produce an invalid effective layout.
 */
function sanitizePreference(
  pref: Partial<WorkspacePreference>,
  mode: WorkspaceMode,
): WorkspacePreference {
  const base = getWorkspaceConfig(mode).panels;
  const overrides = pref.panelOverrides;
  const clean: Partial<Record<PanelId, Partial<PanelConfig>>> = {};
  if (overrides && typeof overrides === 'object') {
    for (const [panelId, ov] of Object.entries(overrides) as [PanelId, unknown][]) {
      const basePanel = base[panelId];
      if (!basePanel || typeof ov !== 'object' || ov === null) continue;
      const entry: Partial<PanelConfig> = {};
      const raw = ov as Record<string, unknown>;
      if (typeof raw.visible === 'boolean') entry.visible = raw.visible;
      if (typeof raw.collapsed === 'boolean') entry.collapsed = raw.collapsed;
      if (typeof raw.order === 'number' && Number.isFinite(raw.order)) entry.order = raw.order;
      if (typeof raw.preferredWidth === 'string') entry.preferredWidth = raw.preferredWidth;
      if (Object.keys(entry).length > 0) clean[panelId] = entry;
    }
  }
  return {
    ...(clean && Object.keys(clean).length > 0 ? { panelOverrides: clean } : {}),
    customized: pref.customized === true,
    ...(typeof pref.lastCustomized === 'number' ? { lastCustomized: pref.lastCustomized } : {}),
  };
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

// ---------------------------------------------------------------------------
// Reactive store
// ---------------------------------------------------------------------------

let cachedPrefs: WorkspacePreferences | null = null;
const listeners = new Set<() => void>();

/** Current preferences (lazily loaded once; reload after loadWorkspacePreferences). */
export function getWorkspacePreferences(): WorkspacePreferences {
  if (!cachedPrefs) cachedPrefs = loadWorkspacePreferences();
  return cachedPrefs;
}

/** Replace the in-memory snapshot (e.g. after a settings reset). */
export function setWorkspacePreferences(prefs: WorkspacePreferences): void {
  cachedPrefs = prefs;
  saveWorkspacePreferences(prefs);
  for (const listener of listeners) listener();
}

/** Apply an update to the preferences snapshot (debounced save). */
export function updateWorkspacePreferences(
  update: (prefs: WorkspacePreferences) => WorkspacePreferences,
): void {
  const next = update(getWorkspacePreferences());
  setWorkspacePreferences(next);
}

/** Subscribe to preference changes; returns an unsubscribe function. */
export function subscribeWorkspacePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: clear the in-memory snapshot so tests reload from storage. */
export function resetWorkspacePreferenceCache(): void {
  cachedPrefs = null;
  listeners.clear();
}

// ---------------------------------------------------------------------------
// Effective configuration
// ---------------------------------------------------------------------------

/** Get the effective panel config for a mode, merging user overrides. */
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

/**
 * Effective workspace configuration = built-in config + user overrides.
 *
 * Only the panel layout participates in overrides today; every other field
 * is the built-in config, so the runtime honors the same shape everywhere
 * without duplicating merge logic per consumer.
 */
export function getEffectiveWorkspaceConfig(
  mode: WorkspaceMode,
  prefs: WorkspacePreferences = getWorkspacePreferences(),
): WorkspaceConfig {
  const base = getWorkspaceConfig(mode);
  const modePrefs = prefs[mode];
  if (!modePrefs?.panelOverrides || Object.keys(modePrefs.panelOverrides).length === 0) {
    return base;
  }
  return {
    ...base,
    panels: {
      ...base.panels,
      ...(Object.fromEntries(
        Object.entries(modePrefs.panelOverrides).map(([id, ov]) => [
          id,
          { ...base.panels[id as PanelId], ...ov },
        ]),
      ) as Record<PanelId, PanelConfig>),
    },
  };
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
