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

import type { Platform } from '@varve/platform';
import type { ToolId } from '../tools/types';
import { ESSENTIAL_TOOL_IDS } from './toolLabels';
import {
  ALL_WORKSPACE_MODES,
  getWorkspaceConfig,
  type InspectorTabId,
  isValidWorkspaceConfig,
  migrateWorkspaceConfig,
  type PanelConfig,
  type PanelId,
  type StatusSectionId,
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

/**
 * Normalize a parsed preferences payload from any store.
 *
 * Both the localStorage mirror and platform storage go through this, so a
 * corrupt or hand-edited payload can never produce an unusable layout
 * regardless of which store it came from. Unknown modes are dropped and
 * missing modes fall back to defaults, which is also how a downgrade (a
 * payload written by a build that knew more workspaces) stays readable.
 */
function sanitizePreferences(parsed: unknown): WorkspacePreferences {
  if (typeof parsed !== 'object' || parsed === null) return createDefaultPreferences();
  const source = parsed as Record<string, unknown>;
  const result: WorkspacePreferences = {} as WorkspacePreferences;
  for (const mode of ALL_WORKSPACE_MODES) {
    const entry = source[mode];
    result[mode] =
      entry && typeof entry === 'object'
        ? sanitizePreference(entry as WorkspacePreference, mode)
        : defaultPreference();
  }
  return result;
}

/** Load all workspace preferences from the localStorage session mirror. */
export function loadWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return createDefaultPreferences();
    return sanitizePreferences(JSON.parse(raw));
  } catch (err) {
    // Unparseable JSON or storage unavailable — start from defaults rather
    // than leaving the editor with no layout at all.
    recordPersistenceError('local', err);
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
      if (typeof raw.preferredWidth === 'string') entry.preferredWidth = raw.preferredWidth;
      if (Object.keys(entry).length > 0) clean[panelId] = entry;
    }
  }

  // Sanitize inspector tab overrides — only boolean visibility flips for known tabs
  const baseTabIds = new Set(base ? getWorkspaceConfig(mode).inspectorTabs.map((t) => t.id) : []);
  const tabRaw = pref.inspectorTabOverrides;
  const cleanTabs: Partial<Record<InspectorTabId, boolean>> = {};
  if (tabRaw && typeof tabRaw === 'object') {
    for (const [tabId, val] of Object.entries(tabRaw)) {
      if (baseTabIds.has(tabId as InspectorTabId) && typeof val === 'boolean') {
        cleanTabs[tabId as InspectorTabId] = val;
      }
    }
  }

  // Sanitize status section overrides — only boolean visibility flips for known sections
  const baseSectionIds = new Set(
    base ? getWorkspaceConfig(mode).statusSections.map((s) => s.id) : [],
  );
  const sectionRaw = pref.statusSectionOverrides;
  const cleanSections: Partial<Record<StatusSectionId, boolean>> = {};
  if (sectionRaw && typeof sectionRaw === 'object') {
    for (const [sectionId, val] of Object.entries(sectionRaw)) {
      if (baseSectionIds.has(sectionId as StatusSectionId) && typeof val === 'boolean') {
        cleanSections[sectionId as StatusSectionId] = val;
      }
    }
  }

  // Sanitize toolbar tool overrides — only boolean visibility values for known
  // tools. Flyout members count as known: boolean operations and any shape that
  // lives only in a flyout are legitimate customization targets, and rejecting
  // them here is what previously made those overrides unsavable.
  const baseToolbar = getWorkspaceConfig(mode).toolbar;
  const baseToolIds = new Set<string>(
    base
      ? [
          ...baseToolbar.tools.map((t) => t.toolId),
          ...(baseToolbar.flyouts ?? []).flatMap((f) => f.tools),
        ]
      : [],
  );
  const toolRaw = pref.toolbarToolOverrides;
  const cleanTools: Partial<Record<string, boolean>> = {};
  if (toolRaw && typeof toolRaw === 'object') {
    for (const [toolId, val] of Object.entries(toolRaw)) {
      if (baseToolIds.has(toolId) && typeof val === 'boolean') {
        cleanTools[toolId] = val;
      }
    }
  }

  // Sanitize per-workspace panel widths. Widths are application state rather
  // than document content, so tolerate stale values and let the panel
  // boundary clamp them against the current viewport when they are applied.
  const widthRaw = pref.panelWidths;
  const cleanWidths: Partial<Record<PanelId, number>> = {};
  if (widthRaw && typeof widthRaw === 'object') {
    for (const [panelId, value] of Object.entries(widthRaw)) {
      if (
        Object.hasOwn(base, panelId) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0
      ) {
        cleanWidths[panelId as PanelId] = value;
      }
    }
  }

  return {
    ...(clean && Object.keys(clean).length > 0 ? { panelOverrides: clean } : {}),
    ...(cleanTabs && Object.keys(cleanTabs).length > 0 ? { inspectorTabOverrides: cleanTabs } : {}),
    ...(cleanSections && Object.keys(cleanSections).length > 0
      ? { statusSectionOverrides: cleanSections }
      : {}),
    ...(cleanTools && Object.keys(cleanTools).length > 0
      ? { toolbarToolOverrides: cleanTools }
      : {}),
    ...(cleanWidths && Object.keys(cleanWidths).length > 0 ? { panelWidths: cleanWidths } : {}),
    customized: pref.customized === true,
    ...(typeof pref.lastCustomized === 'number' ? { lastCustomized: pref.lastCustomized } : {}),
  };
}

/**
 * The last persistence failure, for diagnostics.
 *
 * Persistence must never interrupt editing, but swallowing every error means
 * a user whose customizations silently stop saving has nothing to report and
 * we have nothing to look at. Settings and dev tooling can surface this.
 */
let lastPersistenceError: { at: number; layer: 'local' | 'platform'; message: string } | null =
  null;

export function getWorkspacePersistenceError() {
  return lastPersistenceError;
}

function recordPersistenceError(layer: 'local' | 'platform', err: unknown): void {
  lastPersistenceError = {
    at: Date.now(),
    layer,
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Save workspace preferences.
 *
 * localStorage is the synchronous session mirror — the store is read during
 * render, so it cannot be async. It is not durable on every engine, though:
 * on Linux/WebKitGTK localStorage has been observed not surviving between
 * app launches (the same failure that made the welcome dialog reappear every
 * launch, see `onboard/onboardingStore.ts`). So when a platform is attached
 * the preferences are also written to platform storage — SQLite on desktop,
 * IndexedDB on web — and read back on the next launch by
 * `hydrateWorkspacePreferencesFromPlatform`.
 */
export function saveWorkspacePreferences(prefs: WorkspacePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (err) {
    // Quota exceeded, private browsing, storage disabled. The in-memory
    // snapshot still serves this session.
    recordPersistenceError('local', err);
  }
  scheduleDurableSave(prefs);
}

// ---------------------------------------------------------------------------
// Durable (platform) persistence
// ---------------------------------------------------------------------------

const APP_SETTING_KEY = 'workspace-preferences';
/** Panel toggles are bursty (a reset rewrites every mode); coalesce the writes. */
const DURABLE_SAVE_DEBOUNCE_MS = 400;

let durablePlatform: Platform | null = null;
let durableTimer: ReturnType<typeof setTimeout> | null = null;
let durablePending: WorkspacePreferences | null = null;

/** Register the platform that backs durable preference storage. */
export function attachWorkspacePreferencePlatform(platform: Platform | undefined): void {
  durablePlatform = platform ?? null;
}

function scheduleDurableSave(prefs: WorkspacePreferences): void {
  if (!durablePlatform) return;
  durablePending = prefs;
  if (durableTimer) clearTimeout(durableTimer);
  durableTimer = setTimeout(() => {
    durableTimer = null;
    const pending = durablePending;
    durablePending = null;
    if (!pending || !durablePlatform) return;
    void durablePlatform.setAppSetting(APP_SETTING_KEY, JSON.stringify(pending)).catch((err) => {
      recordPersistenceError('platform', err);
    });
  }, DURABLE_SAVE_DEBOUNCE_MS);
}

/** Flush any debounced durable write immediately (window close, tests). */
export async function flushWorkspacePreferences(): Promise<void> {
  if (durableTimer) {
    clearTimeout(durableTimer);
    durableTimer = null;
  }
  const pending = durablePending;
  durablePending = null;
  if (!pending || !durablePlatform) return;
  try {
    await durablePlatform.setAppSetting(APP_SETTING_KEY, JSON.stringify(pending));
  } catch (err) {
    recordPersistenceError('platform', err);
  }
}

/**
 * Per mode, keep whichever copy was customized more recently.
 *
 * Both stores are legitimate sources: localStorage can be wiped by the
 * WebView while platform storage survives, and platform storage can lag
 * behind a write that has not flushed yet or was made by another window.
 * `lastCustomized` is the only ordering we have, so it decides; an
 * uncustomized entry never displaces a customized one.
 */
function mergePreferencesByRecency(
  local: WorkspacePreferences,
  remote: WorkspacePreferences,
): WorkspacePreferences {
  const merged = {} as WorkspacePreferences;
  for (const mode of ALL_WORKSPACE_MODES) {
    const l = local[mode] ?? defaultPreference();
    const r = remote[mode] ?? defaultPreference();
    if (!r.customized) merged[mode] = l;
    else if (!l.customized) merged[mode] = r;
    else merged[mode] = (r.lastCustomized ?? 0) > (l.lastCustomized ?? 0) ? r : l;
  }
  return merged;
}

/**
 * Load durable preferences and fold them into the session snapshot.
 *
 * Call once at startup. Returns true when the snapshot changed, so the caller
 * knows a re-render is warranted. A missing, empty, or corrupt payload leaves
 * the local snapshot untouched — durability must never be able to *lose*
 * customizations.
 */
export async function hydrateWorkspacePreferencesFromPlatform(
  platform: Platform,
): Promise<boolean> {
  attachWorkspacePreferencePlatform(platform);
  let raw: string | null = null;
  try {
    raw = await platform.getAppSetting(APP_SETTING_KEY);
  } catch (err) {
    recordPersistenceError('platform', err);
    return false;
  }
  if (!raw) return false;

  let remote: WorkspacePreferences;
  try {
    remote = sanitizePreferences(JSON.parse(raw));
  } catch (err) {
    recordPersistenceError('platform', err);
    return false;
  }

  const local = getWorkspacePreferences();
  const merged = mergePreferencesByRecency(local, remote);
  if (JSON.stringify(merged) === JSON.stringify(local)) return false;
  setWorkspacePreferences(merged);
  return true;
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
  if (durableTimer) clearTimeout(durableTimer);
  durableTimer = null;
  durablePending = null;
  durablePlatform = null;
  lastPersistenceError = null;
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
 * Panels, inspector tabs, and status sections each accept per-workspace
 * user overrides. The merge is shallow per field — the built-in config
 * provides the full shape; user overrides only flip visibility.
 */
export function getEffectiveWorkspaceConfig(
  mode: WorkspaceMode,
  prefs: WorkspacePreferences = getWorkspacePreferences(),
): WorkspaceConfig {
  const base = getWorkspaceConfig(mode);
  const modePrefs = prefs[mode];
  if (!modePrefs) return base;

  let result = base;

  // Panel overrides
  if (modePrefs.panelOverrides && Object.keys(modePrefs.panelOverrides).length > 0) {
    result = {
      ...result,
      panels: {
        ...result.panels,
        ...(Object.fromEntries(
          Object.entries(modePrefs.panelOverrides).map(([id, ov]) => [
            id,
            { ...result.panels[id as PanelId], ...ov },
          ]),
        ) as Record<PanelId, PanelConfig>),
      },
    };
  }

  // Inspector tab overrides — flip visibility per tab id
  if (modePrefs.inspectorTabOverrides && Object.keys(modePrefs.inspectorTabOverrides).length > 0) {
    result = {
      ...result,
      inspectorTabs: result.inspectorTabs.map((tab) => {
        const override = modePrefs.inspectorTabOverrides![tab.id as InspectorTabId];
        return override !== undefined ? { ...tab, visible: override } : tab;
      }),
    };
  }

  // Status section overrides — flip visibility per section id
  if (
    modePrefs.statusSectionOverrides &&
    Object.keys(modePrefs.statusSectionOverrides).length > 0
  ) {
    result = {
      ...result,
      statusSections: result.statusSections.map((section) => {
        const override = modePrefs.statusSectionOverrides![section.id as StatusSectionId];
        return override !== undefined ? { ...section, visible: override } : section;
      }),
    };
  }

  // Toolbar tool overrides — filter tools by visibility
  if (modePrefs.toolbarToolOverrides && Object.keys(modePrefs.toolbarToolOverrides).length > 0) {
    // Selection, hand and zoom remain available as recovery/navigation tools.
    // Customization may reduce clutter, but must not strand the user without
    // a way to select objects or navigate the canvas.
    const overrides = modePrefs.toolbarToolOverrides;
    const visible = (toolId: ToolId): boolean =>
      overrides[toolId] !== false || ESSENTIAL_TOOL_IDS.has(toolId);
    // Flyout members are filtered with the same rule. Without this a hidden
    // boolean operation or shape stayed in its flyout, so the override applied
    // to the main row only and customization looked broken for exactly the
    // tools that live in a flyout.
    result = {
      ...result,
      toolbar: {
        ...result.toolbar,
        tools: result.toolbar.tools.filter((t) => visible(t.toolId)),
        ...(result.toolbar.flyouts
          ? {
              flyouts: result.toolbar.flyouts.map((flyout) => ({
                ...flyout,
                tools: flyout.tools.filter(visible),
              })),
            }
          : {}),
      },
    };
  }

  return result;
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

/** Record an inspector tab visibility override for a mode. */
export function setInspectorTabOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  tabId: InspectorTabId,
  visible: boolean,
): WorkspacePreferences {
  const updated = { ...prefs };
  const modePrefs = { ...updated[mode] };
  const tabOverrides = { ...(modePrefs.inspectorTabOverrides ?? {}) };
  tabOverrides[tabId] = visible;
  modePrefs.inspectorTabOverrides = tabOverrides;
  modePrefs.customized = true;
  modePrefs.lastCustomized = Date.now();
  updated[mode] = modePrefs;
  return updated;
}

/** Record a status section visibility override for a mode. */
export function setStatusSectionOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  sectionId: StatusSectionId,
  visible: boolean,
): WorkspacePreferences {
  const updated = { ...prefs };
  const modePrefs = { ...updated[mode] };
  const sectionOverrides = { ...(modePrefs.statusSectionOverrides ?? {}) };
  sectionOverrides[sectionId] = visible;
  modePrefs.statusSectionOverrides = sectionOverrides;
  modePrefs.customized = true;
  modePrefs.lastCustomized = Date.now();
  updated[mode] = modePrefs;
  return updated;
}

/** Save per-workspace panel widths (pixels). */
export function savePanelWidths(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  widths: Partial<Record<PanelId, number>>,
): WorkspacePreferences {
  const updated = { ...prefs };
  const modePrefs = { ...updated[mode] };
  modePrefs.panelWidths = { ...(modePrefs.panelWidths ?? {}), ...widths };
  modePrefs.customized = true;
  modePrefs.lastCustomized = Date.now();
  updated[mode] = modePrefs;
  return updated;
}

/** Get per-workspace panel widths for a mode. */
export function getPanelWidths(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
): Partial<Record<PanelId, number>> {
  return prefs[mode]?.panelWidths ?? {};
}

/** Toggle a toolbar tool's visibility for a workspace. */
export function setToolbarToolOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  toolId: string,
  visible: boolean,
): WorkspacePreferences {
  const updated = { ...prefs };
  const modePrefs = { ...updated[mode] };
  const toolOverrides = { ...(modePrefs.toolbarToolOverrides ?? {}) };
  toolOverrides[toolId] = visible;
  modePrefs.toolbarToolOverrides = toolOverrides;
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
