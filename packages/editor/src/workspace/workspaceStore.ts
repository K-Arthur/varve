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
import { TOOL_REGISTRY } from '../tools/toolRegistry';
import type { ToolId } from '../tools/types';
import { deserializeDockLayout } from './dock/dockOps';
import { mergeDockRestoreState, sanitizeDockRestoreState } from './dock/dockRecovery';
import { DOCK_LAYOUT_SCHEMA_VERSION } from './dock/dockTypes';
import { ESSENTIAL_TOOL_IDS } from './toolLabels';
import {
  ALL_WORKSPACE_PREFERENCE_MODES,
  CHROME_CONFIG_KEYS,
  type ChromeConfig,
  getToolbarToolIds,
  getWorkspaceConfig,
  type InspectorTabId,
  isValidWorkspaceConfig,
  migrateWorkspaceConfig,
  type PanelConfig,
  type PanelId,
  type StatusSectionId,
  type ToolbarPlacement,
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

function sanitizeOrderedIds<T extends string>(
  value: unknown,
  declared: readonly T[],
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<string>(declared);
  const seen = new Set<string>();
  const order = value.filter((id): id is T => {
    if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return order.length > 0 ? order : undefined;
}

function isFutureDockLayout(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const version = (value as Record<string, unknown>).schemaVersion;
  return (
    typeof version === 'number' && Number.isInteger(version) && version > DOCK_LAYOUT_SCHEMA_VERSION
  );
}

function applyDeclaredOrder<T>(
  items: T[],
  order: readonly string[] | undefined,
  id: (item: T) => string,
): T[] {
  if (!order?.length) return items;
  const priority = new Map(order.map((key, index) => [key, index]));
  return items
    .map((item, index) => ({
      item,
      index,
      priority: priority.get(id(item)) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ item }) => item);
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
  for (const mode of ALL_WORKSPACE_PREFERENCE_MODES) {
    const entry = source[mode];
    result[mode] =
      entry && typeof entry === 'object'
        ? sanitizePreference(
            entry as WorkspacePreference,
            mode === 'logo' || mode === 'codegen' ? 'design' : mode,
          )
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
  const baseConfig = getWorkspaceConfig(mode);
  const base = baseConfig.panels;
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
  const baseTabIds = new Set(baseConfig.inspectorTabs.map((t) => t.id));
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
  const baseSectionIds = new Set(baseConfig.statusSections.map((s) => s.id));
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
  const baseToolbar = baseConfig.toolbar;
  const declaredToolbarToolIds = getToolbarToolIds(baseToolbar);
  const baseToolIds = new Set<ToolId>(declaredToolbarToolIds);
  const baseVisibleToolIds = new Set<ToolId>(declaredToolbarToolIds);
  const toolRaw = pref.toolbarToolOverrides;
  const cleanTools: Partial<Record<string, boolean>> = {};
  if (toolRaw && typeof toolRaw === 'object') {
    for (const [toolId, val] of Object.entries(toolRaw)) {
      if (!baseToolIds.has(toolId as ToolId) || typeof val !== 'boolean') continue;
      // Persist only sparse differences from the built-in composition. This
      // lets a newly-added default tool appear for existing users while still
      // preserving an explicit hide/show choice for known tools.
      if (ESSENTIAL_TOOL_IDS.has(toolId as ToolId) && val === false) continue;
      if (baseVisibleToolIds.has(toolId as ToolId) !== val) {
        cleanTools[toolId] = val;
      }
    }
  }

  const toolbarToolOrder = sanitizeOrderedIds(pref.toolbarToolOrder, declaredToolbarToolIds);
  const baseToolLocation = new Map<ToolId, string | null>();
  for (const item of baseToolbar.tools) baseToolLocation.set(item.toolId, null);
  for (const flyout of baseToolbar.flyouts ?? []) {
    for (const toolId of flyout.tools) baseToolLocation.set(toolId, flyout.id);
  }
  const toolbarToolLocations: Partial<Record<ToolId, string | null>> = {};
  const locationRaw = pref.toolbarToolLocations;
  if (locationRaw && typeof locationRaw === 'object') {
    const flyoutIds = new Set((baseToolbar.flyouts ?? []).map((flyout) => flyout.id));
    for (const [id, location] of Object.entries(locationRaw)) {
      if (
        !baseToolIds.has(id as ToolId) ||
        (location !== null &&
          (typeof location !== 'string' ||
            !flyoutIds.has(location) ||
            ESSENTIAL_TOOL_IDS.has(id as ToolId)))
      ) {
        continue;
      }
      const toolId = id as ToolId;
      if (location !== baseToolLocation.get(toolId)) toolbarToolLocations[toolId] = location;
    }
  }
  const pinnedRaw = pref.toolbarPinnedToolIds;
  const toolbarPinnedToolIds = Array.isArray(pinnedRaw)
    ? [
        ...new Set(
          pinnedRaw.filter(
            (id): id is ToolId =>
              typeof id === 'string' &&
              baseToolIds.has(id as ToolId) &&
              !ESSENTIAL_TOOL_IDS.has(id as ToolId),
          ),
        ),
      ]
    : undefined;

  const inspectorTabOrder = sanitizeOrderedIds(
    pref.inspectorTabOrder,
    baseConfig.inspectorTabs.map((tab) => tab.id),
  );
  const inspectorTabPinnedOverrides: Partial<Record<InspectorTabId, boolean>> = {};
  if (pref.inspectorTabPinnedOverrides && typeof pref.inspectorTabPinnedOverrides === 'object') {
    for (const [id, pinned] of Object.entries(pref.inspectorTabPinnedOverrides)) {
      if (baseTabIds.has(id as InspectorTabId) && typeof pinned === 'boolean') {
        inspectorTabPinnedOverrides[id as InspectorTabId] = pinned;
      }
    }
  }
  const statusSectionOrder = sanitizeOrderedIds(
    pref.statusSectionOrder,
    baseConfig.statusSections.map((section) => section.id),
  );

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

  // Sanitize editor-chrome overrides — only known keys, boolean values.
  const chromeRaw = pref.chromeOverrides;
  const cleanChrome: Partial<ChromeConfig> = {};
  if (chromeRaw && typeof chromeRaw === 'object') {
    for (const key of CHROME_CONFIG_KEYS) {
      const value = (chromeRaw as Record<string, unknown>)[key];
      if (typeof value === 'boolean') cleanChrome[key] = value;
    }
  }

  // Sanitize the toolbar placement override — only the two supported values.
  const placement = pref.toolbarPlacement;
  const cleanPlacement: ToolbarPlacement | undefined =
    placement === 'top' || placement === 'bottom' ? placement : undefined;

  // Sanitize the default-tool override. It must be a selectable tool (never a
  // command-only flyout member) that this mode's toolbar can present.
  const selectableToolIds = new Set<string>(
    TOOL_REGISTRY.filter((entry) => entry.kind === 'tool').map((entry) => entry.id),
  );
  const defaultToolRaw = pref.defaultToolOverride;
  const defaultToolOverride =
    typeof defaultToolRaw === 'string' &&
    selectableToolIds.has(defaultToolRaw as ToolId) &&
    baseToolIds.has(defaultToolRaw)
      ? (defaultToolRaw as ToolId)
      : undefined;

  const dockLayoutResult = pref.dockLayout ? deserializeDockLayout(pref.dockLayout) : null;
  const dockLayout = dockLayoutResult?.ok ? dockLayoutResult.layout : undefined;
  const unreadableDockLayout = dockLayout
    ? undefined
    : isFutureDockLayout(pref.dockLayout)
      ? pref.dockLayout
      : pref.unreadableDockLayout;
  const dockRestore = sanitizeDockRestoreState(pref.dockRestore);

  return {
    ...(dockLayout ? { dockLayout } : {}),
    ...(dockRestore ? { dockRestore } : {}),
    ...(unreadableDockLayout ? { unreadableDockLayout } : {}),
    ...(clean && Object.keys(clean).length > 0 ? { panelOverrides: clean } : {}),
    ...(cleanTabs && Object.keys(cleanTabs).length > 0 ? { inspectorTabOverrides: cleanTabs } : {}),
    ...(cleanSections && Object.keys(cleanSections).length > 0
      ? { statusSectionOverrides: cleanSections }
      : {}),
    ...(cleanTools && Object.keys(cleanTools).length > 0
      ? { toolbarToolOverrides: cleanTools }
      : {}),
    ...(toolbarToolOrder ? { toolbarToolOrder } : {}),
    ...(Object.keys(toolbarToolLocations).length > 0 ? { toolbarToolLocations } : {}),
    ...(toolbarPinnedToolIds && toolbarPinnedToolIds.length > 0 ? { toolbarPinnedToolIds } : {}),
    ...(inspectorTabOrder ? { inspectorTabOrder } : {}),
    ...(Object.keys(inspectorTabPinnedOverrides).length > 0 ? { inspectorTabPinnedOverrides } : {}),
    ...(statusSectionOrder ? { statusSectionOrder } : {}),
    ...(cleanWidths && Object.keys(cleanWidths).length > 0 ? { panelWidths: cleanWidths } : {}),
    ...(Object.keys(cleanChrome).length > 0 ? { chromeOverrides: cleanChrome } : {}),
    ...(cleanPlacement ? { toolbarPlacement: cleanPlacement } : {}),
    ...(defaultToolOverride ? { defaultToolOverride } : {}),
    customized: pref.customized === true,
    ...(typeof pref.lastCustomized === 'number' ? { lastCustomized: pref.lastCustomized } : {}),
    ...(typeof pref.clearedAt === 'number' ? { clearedAt: pref.clearedAt } : {}),
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

export type WorkspacePreferenceHydrationState = 'idle' | 'pending' | 'settled';
let preferenceHydrationState: WorkspacePreferenceHydrationState = 'idle';

/** Whether durable preferences have been folded into the synchronous snapshot. */
export function getWorkspacePreferenceHydrationState(): WorkspacePreferenceHydrationState {
  return preferenceHydrationState;
}

let durablePlatform: Platform | null = null;
let durableTimer: ReturnType<typeof setTimeout> | null = null;
let durablePending: WorkspacePreferences | null = null;
let durableWriteQueue: Promise<void> = Promise.resolve();

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
    const platform = durablePlatform;
    if (!pending || !platform) return;
    enqueueDurableWrite(platform, pending);
  }, DURABLE_SAVE_DEBOUNCE_MS);
}

/** Serialize durable writes so an older in-flight snapshot cannot finish last. */
function enqueueDurableWrite(platform: Platform, prefs: WorkspacePreferences): Promise<void> {
  const payload = JSON.stringify(prefs);
  durableWriteQueue = durableWriteQueue.then(async () => {
    try {
      await platform.setAppSetting(APP_SETTING_KEY, payload);
    } catch (err) {
      recordPersistenceError('platform', err);
    }
  });
  return durableWriteQueue;
}

/** Flush any debounced durable write immediately (window close, tests). */
export async function flushWorkspacePreferences(): Promise<void> {
  if (durableTimer) {
    clearTimeout(durableTimer);
    durableTimer = null;
  }
  const pending = durablePending;
  durablePending = null;
  const platform = durablePlatform;
  if (pending && platform) enqueueDurableWrite(platform, pending);
  await durableWriteQueue;
}

/**
 * Per mode, keep whichever copy reflects the user's latest *decision*.
 *
 * Both stores are legitimate sources: localStorage can be wiped by the
 * WebView while platform storage survives, and platform storage can lag
 * behind a write that has not flushed yet or was made by another window.
 * `lastCustomized` and `clearedAt` are the only event ordering we have:
 * a reset is a decision and must beat an older customization, and a
 * customization made after a reset must beat the reset. When neither copy
 * carries an event (both untouched), an uncustomized entry never displaces
 * a customized one.
 */
function preferenceEventTime(pref: WorkspacePreference): number {
  return Math.max(pref.lastCustomized ?? 0, pref.clearedAt ?? 0);
}

function mergePreferencesByRecency(
  local: WorkspacePreferences,
  remote: WorkspacePreferences,
): WorkspacePreferences {
  const merged = {} as WorkspacePreferences;
  for (const mode of ALL_WORKSPACE_PREFERENCE_MODES) {
    const l = local[mode] ?? defaultPreference();
    const r = remote[mode] ?? defaultPreference();
    const localTime = preferenceEventTime(l);
    const remoteTime = preferenceEventTime(r);
    if (localTime !== remoteTime) {
      const selected = localTime > remoteTime ? l : r;
      const dockRestore = mergeDockRestoreState(l.dockRestore, r.dockRestore);
      merged[mode] = dockRestore ? { ...selected, dockRestore } : selected;
      continue;
    }
    // Same event time (usually both zero): preserve the old customized-wins
    // rule, then fall back to the current session's copy.
    let selected: WorkspacePreference;
    if (!r.customized && l.customized) selected = l;
    else if (!l.customized && r.customized) selected = r;
    else selected = l;
    const dockRestore = mergeDockRestoreState(l.dockRestore, r.dockRestore);
    merged[mode] = dockRestore ? { ...selected, dockRestore } : selected;
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
  preferenceHydrationState = 'pending';
  try {
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
  } finally {
    preferenceHydrationState = 'settled';
    // A preference subscriber may need to proceed even when the durable copy
    // was missing or identical to the synchronous snapshot.
    for (const listener of listeners) listener();
  }
}

/** Create default (uncustomized) preferences for all modes. */
function createDefaultPreferences(): WorkspacePreferences {
  const prefs = {} as WorkspacePreferences;
  for (const mode of ALL_WORKSPACE_PREFERENCE_MODES) {
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
  preferenceHydrationState = 'idle';
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
        const pinned = modePrefs.inspectorTabPinnedOverrides?.[tab.id];
        return {
          ...tab,
          ...(override !== undefined ? { visible: override } : {}),
          ...(pinned !== undefined
            ? { overflowPriority: pinned ? 0 : Math.max(5, tab.overflowPriority ?? 1) }
            : {}),
        };
      }),
    };
  } else if (modePrefs.inspectorTabPinnedOverrides) {
    result = {
      ...result,
      inspectorTabs: result.inspectorTabs.map((tab) => {
        const pinned = modePrefs.inspectorTabPinnedOverrides?.[tab.id];
        return pinned === undefined
          ? tab
          : { ...tab, overflowPriority: pinned ? 0 : Math.max(5, tab.overflowPriority ?? 1) };
      }),
    };
  }
  if (modePrefs.inspectorTabOrder) {
    result = {
      ...result,
      inspectorTabs: applyDeclaredOrder(
        result.inspectorTabs,
        modePrefs.inspectorTabOrder,
        (tab) => tab.id,
      ),
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
  if (modePrefs.statusSectionOrder) {
    const ordered = applyDeclaredOrder(
      result.statusSections,
      modePrefs.statusSectionOrder,
      (section) => section.id,
    );
    result = {
      ...result,
      statusSections: ordered.map((section, index) => ({ ...section, order: index * 10 })),
    };
  }

  // Toolbar tool overrides — filter the main row and flyouts together. Empty
  // flyouts are removed here so every consumer of the effective config sees
  // the same reachable set, even if it does not call composeToolbar.
  const declaredToolbar = base.toolbar;
  const toolLocations = modePrefs.toolbarToolLocations ?? {};
  const mainItems = declaredToolbar.tools.map((item) => ({ ...item }));
  const flyouts = (declaredToolbar.flyouts ?? []).map((flyout) => ({
    ...flyout,
    tools: [...flyout.tools],
  }));
  for (const [toolId, location] of Object.entries(toolLocations) as [ToolId, string | null][]) {
    if (ESSENTIAL_TOOL_IDS.has(toolId) && location !== null) continue;
    const mainIndex = mainItems.findIndex((item) => item.toolId === toolId);
    const item = mainIndex >= 0 ? mainItems.splice(mainIndex, 1)[0] : undefined;
    let existingFlyoutId: string | undefined;
    for (const flyout of flyouts) {
      const index = flyout.tools.indexOf(toolId);
      if (index >= 0) {
        flyout.tools.splice(index, 1);
        existingFlyoutId = flyout.id;
        break;
      }
    }
    const original = item ?? { toolId };
    if (location === null || location === undefined) {
      mainItems.push(original);
    } else {
      const destination = flyouts.find((flyout) => flyout.id === location);
      if (destination) destination.tools.push(toolId);
      else if (existingFlyoutId) {
        const source = flyouts.find((flyout) => flyout.id === existingFlyoutId);
        source?.tools.push(toolId);
      } else mainItems.push(original);
    }
  }
  const orderedToolIds = modePrefs.toolbarToolOrder ?? [];
  const overrides = modePrefs.toolbarToolOverrides ?? {};
  const visible = (toolId: ToolId): boolean =>
    overrides[toolId] !== false || ESSENTIAL_TOOL_IDS.has(toolId);
  result = {
    ...result,
    toolbar: {
      ...declaredToolbar,
      tools: applyDeclaredOrder(
        mainItems.filter((item) => visible(item.toolId)),
        orderedToolIds,
        (item) => item.toolId,
      ),
      ...(flyouts.length > 0
        ? {
            flyouts: flyouts
              .map((flyout) => ({ ...flyout, tools: flyout.tools.filter(visible) }))
              .map((flyout) => ({
                ...flyout,
                tools: applyDeclaredOrder(flyout.tools, orderedToolIds, (toolId) => toolId),
              }))
              .filter((flyout) => flyout.tools.length > 0),
          }
        : {}),
    },
    toolbarPinnedToolIds: modePrefs.toolbarPinnedToolIds,
  };

  // Editor chrome overrides (floating toolbar, status bar, tab strip). These
  // are presentation toggles a saved layout can capture; they must not touch
  // renderer policy or document state.
  const chrome = modePrefs.chromeOverrides;
  if (chrome) {
    const patch: Partial<ChromeConfig> = {};
    for (const key of CHROME_CONFIG_KEYS) {
      if (typeof chrome[key] === 'boolean') patch[key] = chrome[key];
    }
    if (Object.keys(patch).length > 0) result = { ...result, ...patch };
  }

  // Toolbar placement override. The built-in default is 'bottom' and the
  // field is optional, so an absent override needs no patch.
  if (modePrefs.toolbarPlacement) {
    result = { ...result, toolbarPlacement: modePrefs.toolbarPlacement };
  }

  // Default-tool override from a saved layout (or an explicit tool choice).
  if (modePrefs.defaultToolOverride) {
    result = { ...result, defaultTool: modePrefs.defaultToolOverride };
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

/** Record a validated nested dock tree for a workspace. */
export function setDockLayoutOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  value: unknown,
): WorkspacePreferences {
  const result = deserializeDockLayout(value);
  if (!result.ok) return prefs;
  const updated = { ...prefs };
  const modePrefs = { ...updated[mode] };
  delete modePrefs.unreadableDockLayout;
  updated[mode] = {
    ...modePrefs,
    dockLayout: result.layout,
    customized: true,
    lastCustomized: Date.now(),
  };
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

/** Remove saved per-workspace widths for the given panels (reset to default). */
export function clearPanelWidths(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  panelIds: PanelId[],
): WorkspacePreferences {
  const modePrefs = prefs[mode];
  if (!modePrefs?.panelWidths) return prefs;
  const remaining: Partial<Record<PanelId, number>> = { ...modePrefs.panelWidths };
  let changed = false;
  for (const panelId of panelIds) {
    if (panelId in remaining) {
      delete remaining[panelId];
      changed = true;
    }
  }
  if (!changed) return prefs;
  return {
    ...prefs,
    [mode]: {
      ...modePrefs,
      panelWidths: remaining,
      customized: true,
      lastCustomized: Date.now(),
    },
  };
}

/** Toggle an editor-chrome surface's visibility for a workspace. */
export function setChromeOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  key: keyof ChromeConfig,
  visible: boolean,
): WorkspacePreferences {
  const modePrefs = prefs[mode];
  // Sparse storage: an override equal to the built-in default is removed so
  // future built-in changes still flow through.
  if (getWorkspaceConfig(mode)[key] === visible) {
    if (!modePrefs?.chromeOverrides || !(key in modePrefs.chromeOverrides)) return prefs;
    const { [key]: _removed, ...rest } = modePrefs.chromeOverrides;
    const nextMode = { ...modePrefs, customized: true, lastCustomized: Date.now() };
    if (Object.keys(rest).length > 0) nextMode.chromeOverrides = rest;
    else delete nextMode.chromeOverrides;
    return { ...prefs, [mode]: nextMode };
  }
  const updated = { ...prefs };
  const nextMode = { ...updated[mode] };
  nextMode.chromeOverrides = { ...(nextMode.chromeOverrides ?? {}), [key]: visible };
  nextMode.customized = true;
  nextMode.lastCustomized = Date.now();
  updated[mode] = nextMode;
  return updated;
}

/** Set the floating toolbar's vertical placement for a workspace. */
export function setToolbarPlacementOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  placement: ToolbarPlacement,
): WorkspacePreferences {
  const modePrefs = prefs[mode];
  // Sparse storage: 'bottom' is the built-in default, so storing it would
  // freeze the preference against any future default change.
  if (placement === 'bottom') {
    if (!modePrefs?.toolbarPlacement) return prefs;
    const nextMode = { ...modePrefs, customized: true, lastCustomized: Date.now() };
    delete nextMode.toolbarPlacement;
    return { ...prefs, [mode]: nextMode };
  }
  if (modePrefs?.toolbarPlacement === placement) return prefs;
  const updated = { ...prefs };
  const nextMode = { ...updated[mode] };
  nextMode.toolbarPlacement = placement;
  nextMode.customized = true;
  nextMode.lastCustomized = Date.now();
  updated[mode] = nextMode;
  return updated;
}

/** Toggle a toolbar tool's visibility for a workspace. */
export function setToolbarToolOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  toolId: string,
  visible: boolean,
): WorkspacePreferences {
  const baseToolbar = getWorkspaceConfig(mode).toolbar;
  const declared = new Set(getToolbarToolIds(baseToolbar));
  if (!declared.has(toolId as ToolId)) return prefs;
  const canonicalId = toolId as ToolId;
  if (ESSENTIAL_TOOL_IDS.has(canonicalId) && !visible) return prefs;

  const updated = { ...prefs };
  const modePrefs = { ...updated[mode] };
  const toolOverrides = { ...(modePrefs.toolbarToolOverrides ?? {}) };
  const builtInVisible = getToolbarToolIds(baseToolbar).includes(canonicalId);
  if (visible === builtInVisible) delete toolOverrides[canonicalId];
  else toolOverrides[canonicalId] = visible;
  modePrefs.toolbarToolOverrides = toolOverrides;
  modePrefs.customized = true;
  modePrefs.lastCustomized = Date.now();
  updated[mode] = modePrefs;
  return updated;
}

function writeCustomizedModePreference(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  fields: Partial<WorkspacePreference>,
  remove: Array<keyof WorkspacePreference> = [],
): WorkspacePreferences {
  const next = { ...prefs[mode], ...fields, customized: true, lastCustomized: Date.now() };
  for (const key of remove) delete next[key];
  return { ...prefs, [mode]: next };
}

/** Reorder toolbar tools while preserving each tool's selectable or flyout identity. */
export function setToolbarToolOrderOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  order: readonly string[],
): WorkspacePreferences {
  const declared = getToolbarToolIds(getWorkspaceConfig(mode).toolbar);
  const clean = sanitizeOrderedIds(order, declared) ?? [];
  if (clean.length !== declared.length) return prefs;
  const sameAsDefault = declared.every((id, index) => clean[index] === id);
  if (sameAsDefault && !prefs[mode]?.toolbarToolOrder) return prefs;
  return writeCustomizedModePreference(
    prefs,
    mode,
    sameAsDefault ? {} : { toolbarToolOrder: clean },
    sameAsDefault ? ['toolbarToolOrder'] : [],
  );
}

/** Move a declared tool to the main row or one of this workspace's existing flyouts. */
export function setToolbarToolLocationOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  toolId: ToolId,
  location: string | null,
): WorkspacePreferences {
  const toolbar = getWorkspaceConfig(mode).toolbar;
  const declared = getToolbarToolIds(toolbar);
  const flyouts = toolbar.flyouts ?? [];
  if (!declared.includes(toolId)) return prefs;
  if (ESSENTIAL_TOOL_IDS.has(toolId) && location !== null) return prefs;
  if (location !== null && !flyouts.some((flyout) => flyout.id === location)) return prefs;
  const original = toolbar.tools.some((item) => item.toolId === toolId)
    ? null
    : (flyouts.find((flyout) => flyout.tools.includes(toolId))?.id ?? null);
  const current = prefs[mode]?.toolbarToolLocations?.[toolId];
  if (location === original && current === undefined) return prefs;
  if (location === original && current !== undefined) {
    const next = { ...(prefs[mode]?.toolbarToolLocations ?? {}) };
    delete next[toolId];
    return writeCustomizedModePreference(
      prefs,
      mode,
      Object.keys(next).length > 0 ? { toolbarToolLocations: next } : {},
      Object.keys(next).length === 0 ? ['toolbarToolLocations'] : [],
    );
  }
  const next = { ...(prefs[mode]?.toolbarToolLocations ?? {}), [toolId]: location };
  return writeCustomizedModePreference(prefs, mode, { toolbarToolLocations: next });
}

/** Keep a tool in the toolbar when space is tight. Essential tools remain pinned independently. */
export function setToolbarToolPinnedOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  toolId: ToolId,
  pinned: boolean,
): WorkspacePreferences {
  if (!getToolbarToolIds(getWorkspaceConfig(mode).toolbar).includes(toolId)) return prefs;
  if (ESSENTIAL_TOOL_IDS.has(toolId) && !pinned) return prefs;
  const current = prefs[mode]?.toolbarPinnedToolIds ?? [];
  const next = pinned
    ? [...new Set([...current, toolId])]
    : current.filter((candidate) => candidate !== toolId);
  if (current.length === next.length && current.every((candidate) => next.includes(candidate))) {
    return prefs;
  }
  return writeCustomizedModePreference(
    prefs,
    mode,
    next.length > 0 ? { toolbarPinnedToolIds: next } : {},
    next.length === 0 ? ['toolbarPinnedToolIds'] : [],
  );
}

/** Reorder inspector tabs without changing their visibility or default selection. */
export function setInspectorTabOrderOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  order: readonly string[],
): WorkspacePreferences {
  const declared = getWorkspaceConfig(mode).inspectorTabs.map((tab) => tab.id);
  const clean = sanitizeOrderedIds(order, declared) ?? [];
  if (clean.length !== declared.length) return prefs;
  const sameAsDefault = declared.every((id, index) => clean[index] === id);
  if (sameAsDefault && !prefs[mode]?.inspectorTabOrder) return prefs;
  return writeCustomizedModePreference(
    prefs,
    mode,
    sameAsDefault ? {} : { inspectorTabOrder: clean },
    sameAsDefault ? ['inspectorTabOrder'] : [],
  );
}

/** Pin or unpin an inspector tab against responsive overflow. */
export function setInspectorTabPinnedOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  tabId: InspectorTabId,
  pinned: boolean,
): WorkspacePreferences {
  const tab = getWorkspaceConfig(mode).inspectorTabs.find((candidate) => candidate.id === tabId);
  if (!tab) return prefs;
  const isDefaultPinned = tab.overflowPriority === 0;
  const current = prefs[mode]?.inspectorTabPinnedOverrides?.[tabId];
  if (pinned === isDefaultPinned && current === undefined) return prefs;
  const next = { ...(prefs[mode]?.inspectorTabPinnedOverrides ?? {}) };
  if (pinned === isDefaultPinned) delete next[tabId];
  else next[tabId] = pinned;
  return writeCustomizedModePreference(
    prefs,
    mode,
    Object.keys(next).length > 0 ? { inspectorTabPinnedOverrides: next } : {},
    Object.keys(next).length === 0 ? ['inspectorTabPinnedOverrides'] : [],
  );
}

/** Reorder status-bar sections while retaining their current visibility settings. */
export function setStatusSectionOrderOverride(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  order: readonly string[],
): WorkspacePreferences {
  const declared = getWorkspaceConfig(mode).statusSections.map((section) => section.id);
  const clean = sanitizeOrderedIds(order, declared) ?? [];
  if (clean.length !== declared.length) return prefs;
  const sameAsDefault = declared.every((id, index) => clean[index] === id);
  if (sameAsDefault && !prefs[mode]?.statusSectionOrder) return prefs;
  return writeCustomizedModePreference(
    prefs,
    mode,
    sameAsDefault ? {} : { statusSectionOrder: clean },
    sameAsDefault ? ['statusSectionOrder'] : [],
  );
}

/** Reset a mode's preferences to defaults, recording the reset as an event. */
export function resetModePreferences(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  clearedAt: number = Date.now(),
): WorkspacePreferences {
  const updated = { ...prefs };
  updated[mode] = { customized: false, clearedAt };
  return updated;
}

/** Reset all workspace preferences to defaults, recording one reset event. */
export function resetAllPreferences(clearedAt: number = Date.now()): WorkspacePreferences {
  const prefs = createDefaultPreferences();
  for (const mode of ALL_WORKSPACE_PREFERENCE_MODES) {
    prefs[mode] = { customized: false, clearedAt };
  }
  return prefs;
}

/**
 * When each mode's latest layout decision happened (customization or reset).
 *
 * Exported for persistence diagnostics/tests; merge logic uses the same value.
 */
export function getPreferenceEventTime(pref: WorkspacePreference | undefined): number {
  if (!pref) return 0;
  return Math.max(pref.lastCustomized ?? 0, pref.clearedAt ?? 0);
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
