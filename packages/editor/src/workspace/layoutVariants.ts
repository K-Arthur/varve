/**
 * Named workspace layout variants — portable, single-window arrangements.
 *
 * A layout variant is a saved arrangement of the surfaces users can already
 * customize: panel visibility and widths, inspector tabs, status-bar
 * sections, toolbar tools, and editor chrome (floating toolbar, status bar,
 * document tabs). It is deliberately *not* a new workspace mode: applying a
 * variant writes the same preference overrides the customize dialog writes,
 * so there is one resolver, one projection, and one persistence path.
 *
 * Payloads are sparse differences from the mode's built-in defaults. A
 * variant captured in one mode can be applied to any mode, which keeps new
 * built-in tools discoverable (fields with no override inherit the target
 * mode's defaults) and avoids silently changing the application-global
 * workspace mode.
 *
 * Storage mirrors `workspaceStore`: a synchronous localStorage snapshot plus
 * durable platform app-setting storage, merged by monotonic revision with
 * deletion tombstones so a stale durable copy cannot resurrect a variant the
 * user deleted.
 */

import type { Platform } from '@varve/platform';
import { TOOL_REGISTRY } from '../tools/toolRegistry';
import type { ToolId } from '../tools/types';
import { ESSENTIAL_TOOL_IDS } from './toolLabels';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  resetModePreferences,
} from './workspaceStore';
import {
  ALL_PANEL_IDS,
  ALL_WORKSPACE_MODES,
  CHROME_CONFIG_KEYS,
  type ChromeConfig,
  getToolbarToolIds,
  getWorkspaceConfig,
  type InspectorTabId,
  type PanelId,
  type StatusSectionId,
  type WorkspaceMode,
  type WorkspacePreference,
  type WorkspacePreferences,
} from './workspaceTypes';

export const LAYOUT_VARIANT_SCHEMA_VERSION = 1;
const STORAGE_KEY = 'varve-workspace-layouts';
const APP_SETTING_KEY = 'workspace-layouts';
const DURABLE_SAVE_DEBOUNCE_MS = 400;
const MAX_VARIANTS = 50;
const MAX_IMPORT_BYTES = 64 * 1024;
const MAX_NAME_LENGTH = 64;
const MIN_PANEL_WIDTH = 120;
const MAX_PANEL_WIDTH = 1200;
/** Hostile timestamps further than this into the future are clamped. */
const MAX_TIMESTAMP_SKEW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayoutPanelOverride {
  visible?: boolean;
  preferredWidth?: string;
}

export interface LayoutPreferencePayload {
  panelOverrides?: Partial<Record<PanelId, LayoutPanelOverride>>;
  inspectorTabOverrides?: Partial<Record<InspectorTabId, boolean>>;
  statusSectionOverrides?: Partial<Record<StatusSectionId, boolean>>;
  toolbarToolOverrides?: Partial<Record<string, boolean>>;
  panelWidths?: Partial<Record<PanelId, number>>;
  chromeOverrides?: Partial<ChromeConfig>;
  /** Selectable tool a layout starts on, when it differs from the mode default. */
  defaultTool?: ToolId;
}

export interface WorkspaceLayoutVariant {
  id: string;
  name: string;
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
  /** Mode the layout was captured from — informational, never an apply target. */
  sourceMode?: WorkspaceMode;
  payload: LayoutPreferencePayload;
}

export interface LayoutResetSnapshot {
  savedAt: number;
  scope: { kind: 'mode'; mode: WorkspaceMode } | { kind: 'all' };
  preferences: WorkspacePreferences;
}

export interface WorkspaceLayoutStoreState {
  schemaVersion: number;
  /** Monotonic local revision; every mutation increments it. */
  revision: number;
  variants: WorkspaceLayoutVariant[];
  /** id → deletedAt. Blocks stale durable copies from resurrecting a variant. */
  tombstones: Record<string, number>;
  resetSnapshot?: LayoutResetSnapshot;
}

export type LayoutMutationResult =
  | { ok: true; state: WorkspaceLayoutStoreState; variant: WorkspaceLayoutVariant }
  | { ok: false; reason: 'duplicate-name' | 'not-found' | 'built-in' | 'invalid-name' | 'limit' };

export type LayoutImportResult =
  | { ok: true; variant: WorkspaceLayoutVariant }
  | { ok: false; reason: 'invalid-json' | 'invalid-format' | 'future-version' | 'too-large' };

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const ALL_PANELS_HIDDEN: Partial<Record<PanelId, LayoutPanelOverride>> = Object.fromEntries(
  ALL_PANEL_IDS.map((panelId) => [panelId, { visible: false }]),
);

const ALL_PANELS_VISIBLE: Partial<Record<PanelId, LayoutPanelOverride>> = Object.fromEntries(
  ALL_PANEL_IDS.map((panelId) => [panelId, { visible: true }]),
);

/**
 * Mode-independent built-in templates.
 *
 * They exist as recovery vocabulary, not decoration: "Default" is the
 * one-click reset, "Every panel" is the never-lose-a-panel escape hatch, and
 * "Focus canvas" exercises the most extreme arrangement while keeping the
 * floating toolbar reachable.
 */
export const BUILT_IN_LAYOUT_VARIANTS: readonly WorkspaceLayoutVariant[] = [
  {
    id: 'builtin-default',
    name: 'Default',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
    payload: {},
  },
  {
    id: 'builtin-every-panel',
    name: 'Every panel',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
    payload: {
      panelOverrides: ALL_PANELS_VISIBLE,
      chromeOverrides: { floatingToolbar: true, statusBar: true, tabStrip: true },
    },
  },
  {
    id: 'builtin-focus-canvas',
    name: 'Focus canvas',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
    payload: {
      panelOverrides: ALL_PANELS_HIDDEN,
      chromeOverrides: { floatingToolbar: true, statusBar: false, tabStrip: false },
    },
  },
  {
    id: 'builtin-comic-print',
    name: 'Comic (print)',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
    sourceMode: 'drawing',
    payload: {
      panelOverrides: {
        layers: { visible: true },
        inspector: { visible: true },
        pagenav: { visible: true },
        timeline: { visible: false },
        library: { visible: true },
        codegen: { visible: false },
        logo: { visible: false },
        history: { visible: true },
      },
      inspectorTabOverrides: { fonts: true, export: true },
      toolbarToolOverrides: { panel: true, text: true, frame: true, pen: true, paint: true },
      defaultTool: 'panel',
      chromeOverrides: { floatingToolbar: true, statusBar: true, tabStrip: true },
    },
  },
  {
    id: 'builtin-webtoon-vertical',
    name: 'Webtoon (vertical)',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
    sourceMode: 'drawing',
    payload: {
      panelOverrides: {
        layers: { visible: true },
        inspector: { visible: true },
        pagenav: { visible: true },
        timeline: { visible: false },
        library: { visible: false },
        codegen: { visible: false },
        logo: { visible: false },
        history: { visible: false },
      },
      inspectorTabOverrides: { fonts: true, export: true },
      toolbarToolOverrides: { panel: true, text: true, frame: true, pen: true, paint: true },
      defaultTool: 'panel',
      chromeOverrides: { floatingToolbar: true, statusBar: true, tabStrip: true },
    },
  },
];

export function isBuiltInLayoutId(id: string): boolean {
  return BUILT_IN_LAYOUT_VARIANTS.some((variant) => variant.id === id);
}

export function getBuiltInLayoutVariant(id: string): WorkspaceLayoutVariant | undefined {
  return BUILT_IN_LAYOUT_VARIANTS.find((variant) => variant.id === id);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function clampTimestamp(value: unknown, now: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return now;
  return Math.min(value, now + MAX_TIMESTAMP_SKEW_MS);
}

/** Trim, collapse whitespace, strip control characters, bound length. */
export function normalizeLayoutName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const withoutControl = [...raw]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('');
  const cleaned = withoutControl.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

function isSaneId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** Union of every id any built-in mode declares — the import allowlist. */
function layoutIdAllowlists(): {
  toolbarToolIds: Set<string>;
  inspectorTabIds: Set<string>;
  statusSectionIds: Set<string>;
} {
  const toolbarToolIds = new Set<string>();
  const inspectorTabIds = new Set<string>();
  const statusSectionIds = new Set<string>();
  for (const mode of ALL_WORKSPACE_MODES) {
    const config = getWorkspaceConfig(mode);
    for (const id of getToolbarToolIds(config.toolbar)) toolbarToolIds.add(id);
    for (const tab of config.inspectorTabs) inspectorTabIds.add(tab.id);
    for (const section of config.statusSections) statusSectionIds.add(section.id);
  }
  return { toolbarToolIds, inspectorTabIds, statusSectionIds };
}

/**
 * Sanitize an untrusted payload into the known capability surface.
 *
 * Unknown/removed panel, tab, section, and tool ids are dropped rather than
 * rejected — that is the forward/downgrade compatibility rule the preference
 * sanitizer already follows. Only registered ids can ever influence a
 * surface; no payload can reference arbitrary modules, URLs, or commands.
 */
export function sanitizeLayoutPayload(raw: unknown): LayoutPreferencePayload {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const { toolbarToolIds, inspectorTabIds, statusSectionIds } = layoutIdAllowlists();
  const payload: LayoutPreferencePayload = {};

  const panelRaw = source.panelOverrides;
  if (panelRaw && typeof panelRaw === 'object') {
    const panels: Partial<Record<PanelId, LayoutPanelOverride>> = {};
    for (const panelId of ALL_PANEL_IDS) {
      const entry = (panelRaw as Record<string, unknown>)[panelId];
      if (!entry || typeof entry !== 'object') continue;
      const override: LayoutPanelOverride = {};
      const value = entry as Record<string, unknown>;
      if (typeof value.visible === 'boolean') override.visible = value.visible;
      if (
        typeof value.preferredWidth === 'string' &&
        value.preferredWidth.length > 0 &&
        value.preferredWidth.length <= 32
      ) {
        override.preferredWidth = value.preferredWidth;
      }
      if (Object.keys(override).length > 0) panels[panelId] = override;
    }
    if (Object.keys(panels).length > 0) payload.panelOverrides = panels;
  }

  const tabRaw = source.inspectorTabOverrides;
  if (tabRaw && typeof tabRaw === 'object') {
    const tabs: Partial<Record<InspectorTabId, boolean>> = {};
    for (const [id, value] of Object.entries(tabRaw)) {
      if (inspectorTabIds.has(id) && typeof value === 'boolean') {
        tabs[id as InspectorTabId] = value;
      }
    }
    if (Object.keys(tabs).length > 0) payload.inspectorTabOverrides = tabs;
  }

  const sectionRaw = source.statusSectionOverrides;
  if (sectionRaw && typeof sectionRaw === 'object') {
    const sections: Partial<Record<StatusSectionId, boolean>> = {};
    for (const [id, value] of Object.entries(sectionRaw)) {
      if (statusSectionIds.has(id) && typeof value === 'boolean') {
        sections[id as StatusSectionId] = value;
      }
    }
    if (Object.keys(sections).length > 0) payload.statusSectionOverrides = sections;
  }

  const toolRaw = source.toolbarToolOverrides;
  if (toolRaw && typeof toolRaw === 'object') {
    const tools: Partial<Record<string, boolean>> = {};
    for (const [id, value] of Object.entries(toolRaw)) {
      if (!toolbarToolIds.has(id) || typeof value !== 'boolean') continue;
      // Essential recovery tools can never be hidden by a layout.
      if (ESSENTIAL_TOOL_IDS.has(id as ToolId) && value === false) continue;
      tools[id] = value;
    }
    if (Object.keys(tools).length > 0) payload.toolbarToolOverrides = tools;
  }

  const defaultToolRaw = source.defaultTool;
  if (typeof defaultToolRaw === 'string' && toolbarToolIds.has(defaultToolRaw)) {
    const definition = TOOL_REGISTRY.find((entry) => entry.id === defaultToolRaw);
    if (definition?.kind === 'tool') payload.defaultTool = defaultToolRaw as ToolId;
  }

  const widthRaw = source.panelWidths;
  if (widthRaw && typeof widthRaw === 'object') {
    const widths: Partial<Record<PanelId, number>> = {};
    for (const panelId of ALL_PANEL_IDS) {
      const value = (widthRaw as Record<string, unknown>)[panelId];
      if (typeof value === 'number' && Number.isFinite(value)) {
        widths[panelId] = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(value)));
      }
    }
    if (Object.keys(widths).length > 0) payload.panelWidths = widths;
  }

  const chromeRaw = source.chromeOverrides;
  if (chromeRaw && typeof chromeRaw === 'object') {
    const chrome: Partial<ChromeConfig> = {};
    for (const key of CHROME_CONFIG_KEYS) {
      const value = (chromeRaw as Record<string, unknown>)[key];
      if (typeof value === 'boolean') chrome[key] = value;
    }
    if (Object.keys(chrome).length > 0) payload.chromeOverrides = chrome;
  }

  return payload;
}

function payloadHasContent(payload: LayoutPreferencePayload): boolean {
  return Object.keys(payload).length > 0;
}

/** Structural equality for sparse payloads (order-insensitive). */
export function layoutPayloadsEqual(
  a: LayoutPreferencePayload,
  b: LayoutPreferencePayload,
): boolean {
  return JSON.stringify(sortPayload(a)) === JSON.stringify(sortPayload(b));
}

function sortPayload(payload: LayoutPreferencePayload): unknown {
  const normalize = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(normalize);
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = normalize(source[key]);
    return sorted;
  };
  return normalize(payload);
}

// ---------------------------------------------------------------------------
// Store construction and sanitization
// ---------------------------------------------------------------------------

export function createEmptyLayoutStore(): WorkspaceLayoutStoreState {
  return {
    schemaVersion: LAYOUT_VARIANT_SCHEMA_VERSION,
    revision: 0,
    variants: [],
    tombstones: {},
    resetSnapshot: undefined,
  };
}

function sanitizeVariant(raw: unknown): WorkspaceLayoutVariant | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (!isSaneId(source.id)) return null;
  // Built-in ids are reserved; a stored variant claiming one is a forgery.
  if (isBuiltInLayoutId(source.id)) return null;
  const name = normalizeLayoutName(source.name);
  if (!name) return null;
  const now = Date.now();
  const sourceMode =
    typeof source.sourceMode === 'string' &&
    (ALL_WORKSPACE_MODES as readonly string[]).includes(source.sourceMode)
      ? (source.sourceMode as WorkspaceMode)
      : undefined;
  return {
    id: source.id,
    name,
    builtIn: false,
    createdAt: clampTimestamp(source.createdAt, now),
    updatedAt: clampTimestamp(source.updatedAt, now),
    ...(sourceMode ? { sourceMode } : {}),
    payload: sanitizeLayoutPayload(source.payload),
  };
}

function sanitizeTombstones(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null) return {};
  const tombstones: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (isSaneId(id) && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      tombstones[id] = value;
    }
  }
  return tombstones;
}

function sanitizeResetSnapshot(raw: unknown): LayoutResetSnapshot | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const scopeRaw = source.scope as Record<string, unknown> | undefined;
  if (!scopeRaw || (scopeRaw.kind !== 'mode' && scopeRaw.kind !== 'all')) return undefined;
  if (
    scopeRaw.kind === 'mode' &&
    !(ALL_WORKSPACE_MODES as readonly string[]).includes(String(scopeRaw.mode))
  ) {
    return undefined;
  }
  if (typeof source.preferences !== 'object' || source.preferences === null) return undefined;
  const now = Date.now();
  return {
    savedAt: clampTimestamp(source.savedAt, now),
    scope:
      scopeRaw.kind === 'mode'
        ? { kind: 'mode', mode: scopeRaw.mode as WorkspaceMode }
        : { kind: 'all' },
    // Preferences are re-sanitized by the workspace store when restored; keep
    // a defensive JSON copy here so hostile nested objects are inert.
    preferences: JSON.parse(JSON.stringify(source.preferences)) as WorkspacePreferences,
  };
}

/** Sanitize a full persisted store payload from either storage layer. */
export function sanitizeLayoutStore(parsed: unknown): WorkspaceLayoutStoreState {
  if (typeof parsed !== 'object' || parsed === null) return createEmptyLayoutStore();
  const source = parsed as Record<string, unknown>;
  if (
    typeof source.schemaVersion !== 'number' ||
    !Number.isInteger(source.schemaVersion) ||
    source.schemaVersion < 1 ||
    source.schemaVersion > LAYOUT_VARIANT_SCHEMA_VERSION
  ) {
    // Unknown future payloads are left unread (never rewritten) so a newer
    // build can still consume them after a downgrade.
    return createEmptyLayoutStore();
  }

  const tombstones = sanitizeTombstones(source.tombstones);
  const variants: WorkspaceLayoutVariant[] = [];
  if (Array.isArray(source.variants)) {
    for (const raw of source.variants) {
      const variant = sanitizeVariant(raw);
      if (!variant) continue;
      // Tombstone wins when it is at least as new as the variant.
      if ((tombstones[variant.id] ?? 0) >= variant.updatedAt) continue;
      if (variants.some((existing) => existing.id === variant.id)) continue;
      if (variants.length >= MAX_VARIANTS) break;
      variants.push(variant);
    }
  }

  const resetSnapshot = sanitizeResetSnapshot(source.resetSnapshot);
  return {
    schemaVersion: LAYOUT_VARIANT_SCHEMA_VERSION,
    revision:
      typeof source.revision === 'number' && Number.isFinite(source.revision)
        ? Math.max(0, Math.floor(source.revision))
        : 0,
    variants,
    tombstones,
    ...(resetSnapshot ? { resetSnapshot } : {}),
  };
}

// ---------------------------------------------------------------------------
// Capture and apply
// ---------------------------------------------------------------------------

/**
 * Capture the active mode's current arrangement as a sparse layout payload.
 *
 * Only differences from the mode's built-in defaults are stored: equality
 * carries no information, and a sparse payload lets a layout saved before a
 * new tool shipped still reveal that tool when it is applied later.
 */
export function captureLayoutPayload(
  mode: WorkspaceMode,
  prefs: WorkspacePreferences = getWorkspacePreferences(),
): LayoutPreferencePayload {
  const base = getWorkspaceConfig(mode);
  const effective = getEffectiveWorkspaceConfig(mode, prefs);
  const payload: LayoutPreferencePayload = {};

  const panelOverrides: Partial<Record<PanelId, LayoutPanelOverride>> = {};
  for (const panelId of ALL_PANEL_IDS) {
    const baseVisible = base.panels[panelId].visible;
    const effectiveVisible = effective.panels[panelId].visible;
    if (baseVisible !== effectiveVisible) panelOverrides[panelId] = { visible: effectiveVisible };
  }
  if (Object.keys(panelOverrides).length > 0) payload.panelOverrides = panelOverrides;

  const tabOverrides: Partial<Record<InspectorTabId, boolean>> = {};
  for (const tab of effective.inspectorTabs) {
    const baseTab = base.inspectorTabs.find((candidate) => candidate.id === tab.id);
    if (baseTab && baseTab.visible !== tab.visible) tabOverrides[tab.id] = tab.visible;
  }
  if (Object.keys(tabOverrides).length > 0) payload.inspectorTabOverrides = tabOverrides;

  const sectionOverrides: Partial<Record<StatusSectionId, boolean>> = {};
  for (const section of effective.statusSections) {
    const baseSection = base.statusSections.find((candidate) => candidate.id === section.id);
    if (baseSection && baseSection.visible !== section.visible) {
      sectionOverrides[section.id] = section.visible;
    }
  }
  if (Object.keys(sectionOverrides).length > 0) payload.statusSectionOverrides = sectionOverrides;

  const baseTools = new Set(getToolbarToolIds(base.toolbar));
  const effectiveTools = new Set(getToolbarToolIds(effective.toolbar));
  const toolOverrides: Partial<Record<string, boolean>> = {};
  for (const toolId of baseTools) {
    if (!effectiveTools.has(toolId)) toolOverrides[toolId] = false;
  }
  for (const toolId of effectiveTools) {
    if (!baseTools.has(toolId)) toolOverrides[toolId] = true;
  }
  if (Object.keys(toolOverrides).length > 0) payload.toolbarToolOverrides = toolOverrides;

  const widths = prefs[mode]?.panelWidths;
  if (widths && Object.keys(widths).length > 0) payload.panelWidths = { ...widths };

  const chrome: Partial<ChromeConfig> = {};
  for (const key of CHROME_CONFIG_KEYS) {
    if (base[key] !== effective[key]) chrome[key] = effective[key];
  }
  if (Object.keys(chrome).length > 0) payload.chromeOverrides = chrome;

  if (effective.defaultTool !== base.defaultTool) {
    payload.defaultTool = effective.defaultTool;
  }

  return payload;
}

/**
 * Apply a layout payload to a mode's preferences.
 *
 * Application **replaces** the mode's current arrangement rather than merging
 * with it — "Apply" that leaves unknown residue is not reproducible. An empty
 * payload is a reset and records a clearedAt event, so a stale durable copy
 * cannot resurrect the arrangement the user just replaced.
 */
export function applyLayoutPayloadToPreferences(
  prefs: WorkspacePreferences,
  mode: WorkspaceMode,
  payload: LayoutPreferencePayload,
): WorkspacePreferences {
  const clean = sanitizeLayoutPayload(payload);
  if (!payloadHasContent(clean)) return resetModePreferences(prefs, mode);

  const modePrefs: WorkspacePreference = {
    customized: true,
    lastCustomized: Date.now(),
    ...(clean.panelOverrides ? { panelOverrides: clean.panelOverrides } : {}),
    ...(clean.inspectorTabOverrides ? { inspectorTabOverrides: clean.inspectorTabOverrides } : {}),
    ...(clean.statusSectionOverrides
      ? { statusSectionOverrides: clean.statusSectionOverrides }
      : {}),
    ...(clean.toolbarToolOverrides ? { toolbarToolOverrides: clean.toolbarToolOverrides } : {}),
    ...(clean.panelWidths ? { panelWidths: clean.panelWidths } : {}),
    ...(clean.chromeOverrides ? { chromeOverrides: clean.chromeOverrides } : {}),
    ...(clean.defaultTool ? { defaultToolOverride: clean.defaultTool } : {}),
  };
  return { ...prefs, [mode]: modePrefs };
}

/** Whether a variant's sparse payload currently matches the mode's state. */
export function isLayoutVariantApplied(
  variant: WorkspaceLayoutVariant,
  mode: WorkspaceMode,
  prefs: WorkspacePreferences = getWorkspacePreferences(),
): boolean {
  return layoutPayloadsEqual(
    captureLayoutPayload(mode, prefs),
    sanitizeLayoutPayload(variant.payload),
  );
}

// ---------------------------------------------------------------------------
// CRUD (pure transforms)
// ---------------------------------------------------------------------------

function nextVariantId(now: number): string {
  return `lv-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function withVariantReplaced(
  state: WorkspaceLayoutStoreState,
  variant: WorkspaceLayoutVariant,
): WorkspaceLayoutStoreState {
  const variants = state.variants.map((existing) =>
    existing.id === variant.id ? variant : existing,
  );
  return { ...state, variants, revision: state.revision + 1 };
}

function isDuplicateName(
  state: WorkspaceLayoutStoreState,
  name: string,
  exceptId?: string,
): boolean {
  const normalized = name.toLocaleLowerCase();
  return state.variants.some(
    (variant) => variant.id !== exceptId && variant.name.toLocaleLowerCase() === normalized,
  );
}

/** Save the current arrangement as a new named variant. */
export function addLayoutVariant(
  state: WorkspaceLayoutStoreState,
  input: { name: string; sourceMode: WorkspaceMode; payload: LayoutPreferencePayload },
  now: number = Date.now(),
): LayoutMutationResult {
  const name = normalizeLayoutName(input.name);
  if (!name) return { ok: false, reason: 'invalid-name' };
  if (isDuplicateName(state, name)) return { ok: false, reason: 'duplicate-name' };
  if (state.variants.length >= MAX_VARIANTS) return { ok: false, reason: 'limit' };
  const variant: WorkspaceLayoutVariant = {
    id: nextVariantId(now),
    name,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
    sourceMode: input.sourceMode,
    payload: sanitizeLayoutPayload(input.payload),
  };
  const next = {
    ...state,
    variants: [...state.variants, variant],
    revision: state.revision + 1,
  };
  return { ok: true, state: next, variant };
}

/** Overwrite a user variant's arrangement with the current one. */
export function updateLayoutVariantPayload(
  state: WorkspaceLayoutStoreState,
  id: string,
  payload: LayoutPreferencePayload,
  now: number = Date.now(),
): LayoutMutationResult {
  if (isBuiltInLayoutId(id)) return { ok: false, reason: 'built-in' };
  const existing = state.variants.find((variant) => variant.id === id);
  if (!existing) return { ok: false, reason: 'not-found' };
  const variant = { ...existing, payload: sanitizeLayoutPayload(payload), updatedAt: now };
  return { ok: true, state: withVariantReplaced(state, variant), variant };
}

export function renameLayoutVariant(
  state: WorkspaceLayoutStoreState,
  id: string,
  name: string,
  now: number = Date.now(),
): LayoutMutationResult {
  if (isBuiltInLayoutId(id)) return { ok: false, reason: 'built-in' };
  const cleaned = normalizeLayoutName(name);
  if (!cleaned) return { ok: false, reason: 'invalid-name' };
  const existing = state.variants.find((variant) => variant.id === id);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (isDuplicateName(state, cleaned, id)) return { ok: false, reason: 'duplicate-name' };
  const variant = { ...existing, name: cleaned, updatedAt: now };
  return { ok: true, state: withVariantReplaced(state, variant), variant };
}

/** Duplicate a user variant; built-in templates are not persisted copies. */
export function duplicateLayoutVariant(
  state: WorkspaceLayoutStoreState,
  id: string,
  now: number = Date.now(),
): LayoutMutationResult {
  const source = state.variants.find((variant) => variant.id === id);
  if (!source) {
    const builtIn = getBuiltInLayoutVariant(id);
    if (!builtIn) return { ok: false, reason: 'not-found' };
    // Duplicating a built-in creates a user variant that can be edited.
    let name = `${builtIn.name} copy`;
    let counter = 2;
    while (isDuplicateName(state, name)) {
      name = `${builtIn.name} copy ${counter}`;
      counter += 1;
    }
    const variant: WorkspaceLayoutVariant = {
      id: nextVariantId(now),
      name,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
      payload: sanitizeLayoutPayload(builtIn.payload),
    };
    return {
      ok: true,
      state: { ...state, variants: [...state.variants, variant], revision: state.revision + 1 },
      variant,
    };
  }
  if (state.variants.length >= MAX_VARIANTS) return { ok: false, reason: 'limit' };
  let name = `${source.name} copy`;
  let counter = 2;
  while (isDuplicateName(state, name)) {
    name = `${source.name} copy ${counter}`;
    counter += 1;
  }
  const variant: WorkspaceLayoutVariant = {
    ...source,
    id: nextVariantId(now),
    name,
    createdAt: now,
    updatedAt: now,
    payload: sanitizeLayoutPayload(source.payload),
  };
  return {
    ok: true,
    state: { ...state, variants: [...state.variants, variant], revision: state.revision + 1 },
    variant,
  };
}

export function deleteLayoutVariant(
  state: WorkspaceLayoutStoreState,
  id: string,
  now: number = Date.now(),
): WorkspaceLayoutStoreState {
  if (isBuiltInLayoutId(id)) return state;
  if (!state.variants.some((variant) => variant.id === id)) return state;
  return {
    ...state,
    variants: state.variants.filter((variant) => variant.id !== id),
    tombstones: { ...state.tombstones, [id]: now },
    revision: state.revision + 1,
  };
}

// ---------------------------------------------------------------------------
// Reset snapshot
// ---------------------------------------------------------------------------

export function captureResetSnapshot(
  state: WorkspaceLayoutStoreState,
  scope: LayoutResetSnapshot['scope'],
  preferences: WorkspacePreferences,
  now: number = Date.now(),
): WorkspaceLayoutStoreState {
  return {
    ...state,
    resetSnapshot: {
      savedAt: now,
      scope,
      preferences: JSON.parse(JSON.stringify(preferences)) as WorkspacePreferences,
    },
    revision: state.revision + 1,
  };
}

/**
 * Restore the pre-reset snapshot as a new layout decision.
 *
 * Restored entries get a fresh event timestamp so the restore outranks the
 * reset it is undoing in the next local/platform merge.
 */
export function restoreResetSnapshotToPreferences(
  prefs: WorkspacePreferences,
  snapshot: LayoutResetSnapshot,
  now: number = Date.now(),
): WorkspacePreferences {
  const stamp = (entry: WorkspacePreference): WorkspacePreference => ({
    ...entry,
    ...(entry.customized ? { lastCustomized: now } : { clearedAt: now }),
  });
  if (snapshot.scope.kind === 'all') {
    const restored = { ...prefs };
    for (const mode of ALL_WORKSPACE_MODES) {
      const entry = snapshot.preferences[mode];
      if (entry) restored[mode] = stamp(entry);
    }
    return restored;
  }
  const entry = snapshot.preferences[snapshot.scope.mode];
  if (!entry) return prefs;
  return { ...prefs, [snapshot.scope.mode]: stamp(entry) };
}

export function clearResetSnapshot(state: WorkspaceLayoutStoreState): WorkspaceLayoutStoreState {
  if (!state.resetSnapshot) return state;
  const next = { ...state, revision: state.revision + 1 };
  delete next.resetSnapshot;
  return next;
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

/**
 * Export a portable layout document.
 *
 * Contains no ids, timestamps, machine geometry, paths, or user identity —
 * just the name, source mode, and the sanitized capability payload.
 */
export function exportLayoutVariant(variant: WorkspaceLayoutVariant): string {
  return JSON.stringify(
    {
      kind: 'varve-workspace-layout',
      schemaVersion: LAYOUT_VARIANT_SCHEMA_VERSION,
      name: variant.name,
      sourceMode: variant.sourceMode,
      payload: sanitizeLayoutPayload(variant.payload),
    },
    null,
    2,
  );
}

export function importLayoutVariantFromJson(json: string): LayoutImportResult {
  if (typeof json !== 'string') return { ok: false, reason: 'invalid-json' };
  if (json.length > MAX_IMPORT_BYTES) return { ok: false, reason: 'too-large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'invalid-format' };
  const source = parsed as Record<string, unknown>;
  if (source.kind !== 'varve-workspace-layout') return { ok: false, reason: 'invalid-format' };
  const version = source.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'invalid-format' };
  }
  if (version > LAYOUT_VARIANT_SCHEMA_VERSION) return { ok: false, reason: 'future-version' };
  const name = normalizeLayoutName(source.name) ?? 'Imported layout';
  const now = Date.now();
  const sourceMode =
    typeof source.sourceMode === 'string' &&
    (ALL_WORKSPACE_MODES as readonly string[]).includes(source.sourceMode)
      ? (source.sourceMode as WorkspaceMode)
      : undefined;
  return {
    ok: true,
    variant: {
      // Imported ids are untrusted references; always assign a fresh local id.
      id: nextVariantId(now),
      name,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
      ...(sourceMode ? { sourceMode } : {}),
      payload: sanitizeLayoutPayload(source.payload),
    },
  };
}

/** Add an imported variant, replacing or duplicating a name collision. */
export function addImportedLayoutVariant(
  state: WorkspaceLayoutStoreState,
  variant: WorkspaceLayoutVariant,
  collision: 'replace' | 'duplicate' = 'duplicate',
  now: number = Date.now(),
): LayoutMutationResult {
  const existing = state.variants.find(
    (candidate) =>
      candidate.name.toLocaleLowerCase() === variant.name.toLocaleLowerCase() &&
      candidate.id !== variant.id,
  );
  if (existing && collision === 'replace') {
    const replaced: WorkspaceLayoutVariant = {
      ...existing,
      payload: sanitizeLayoutPayload(variant.payload),
      sourceMode: variant.sourceMode,
      updatedAt: now,
    };
    return { ok: true, state: withVariantReplaced(state, replaced), variant: replaced };
  }
  if (existing) {
    let name = `${variant.name} (imported)`;
    let counter = 2;
    while (isDuplicateName(state, name)) {
      name = `${variant.name} (imported ${counter})`;
      counter += 1;
    }
    const copy = { ...variant, name, updatedAt: now, createdAt: now };
    return {
      ok: true,
      state: {
        ...state,
        variants: [...state.variants, copy],
        revision: state.revision + 1,
      },
      variant: copy,
    };
  }
  return {
    ok: true,
    state: { ...state, variants: [...state.variants, variant], revision: state.revision + 1 },
    variant,
  };
}

// ---------------------------------------------------------------------------
// Reactive store + persistence
// ---------------------------------------------------------------------------

let cachedStore: WorkspaceLayoutStoreState | null = null;
const listeners = new Set<() => void>();
let durablePlatform: Platform | null = null;
let durableTimer: ReturnType<typeof setTimeout> | null = null;
let durablePending: WorkspaceLayoutStoreState | null = null;
let lastPersistenceError: { at: number; layer: 'local' | 'platform'; message: string } | null =
  null;

export function getLayoutPersistenceError() {
  return lastPersistenceError;
}

function recordPersistenceError(layer: 'local' | 'platform', err: unknown): void {
  lastPersistenceError = {
    at: Date.now(),
    layer,
    message: err instanceof Error ? err.message : String(err),
  };
}

export function loadLayoutStore(): WorkspaceLayoutStoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyLayoutStore();
    return sanitizeLayoutStore(JSON.parse(raw));
  } catch (err) {
    recordPersistenceError('local', err);
    return createEmptyLayoutStore();
  }
}

export function getLayoutStore(): WorkspaceLayoutStoreState {
  if (!cachedStore) cachedStore = loadLayoutStore();
  return cachedStore;
}

export function setLayoutStore(state: WorkspaceLayoutStoreState): void {
  cachedStore = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    recordPersistenceError('local', err);
  }
  scheduleDurableSave(state);
  for (const listener of listeners) listener();
}

export function updateLayoutStore(
  update: (state: WorkspaceLayoutStoreState) => WorkspaceLayoutStoreState,
): WorkspaceLayoutStoreState {
  const current = getLayoutStore();
  const next = update(current);
  if (next !== current) setLayoutStore(next);
  return next;
}

export function subscribeLayoutStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetLayoutStoreCache(): void {
  cachedStore = null;
  listeners.clear();
  if (durableTimer) clearTimeout(durableTimer);
  durableTimer = null;
  durablePending = null;
  durablePlatform = null;
  lastPersistenceError = null;
}

export function attachLayoutStorePlatform(platform: Platform | undefined): void {
  durablePlatform = platform ?? null;
}

function scheduleDurableSave(state: WorkspaceLayoutStoreState): void {
  if (!durablePlatform) return;
  durablePending = state;
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

export async function flushLayoutStore(): Promise<void> {
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
 * Merge two stores by revision, variant freshness, and tombstone time.
 *
 * A variant survives only if it is newer than its tombstone; tombstones are
 * unioned at their newest timestamp, so a deletion made on one copy wins over
 * an older re-save on the other. The reset snapshot keeps the newer one.
 */
export function mergeLayoutStores(
  local: WorkspaceLayoutStoreState,
  remote: WorkspaceLayoutStoreState,
): WorkspaceLayoutStoreState {
  const tombstones: Record<string, number> = { ...local.tombstones };
  for (const [id, deletedAt] of Object.entries(remote.tombstones)) {
    tombstones[id] = Math.max(tombstones[id] ?? 0, deletedAt);
  }

  const byId = new Map<string, WorkspaceLayoutVariant>();
  for (const variant of [...remote.variants, ...local.variants]) {
    const existing = byId.get(variant.id);
    if (!existing || variant.updatedAt > existing.updatedAt) byId.set(variant.id, variant);
  }
  const variants = [...byId.values()].filter(
    (variant) => (tombstones[variant.id] ?? 0) < variant.updatedAt,
  );
  variants.sort((a, b) => a.createdAt - b.createdAt);

  const localSnapshot = local.resetSnapshot;
  const remoteSnapshot = remote.resetSnapshot;
  const resetSnapshot =
    !localSnapshot || (remoteSnapshot && remoteSnapshot.savedAt > localSnapshot.savedAt)
      ? remoteSnapshot
      : localSnapshot;

  const mergedRevision = Math.max(local.revision, remote.revision) + 1;
  return {
    schemaVersion: LAYOUT_VARIANT_SCHEMA_VERSION,
    revision: mergedRevision,
    variants,
    tombstones,
    ...(resetSnapshot ? { resetSnapshot } : {}),
  };
}

/**
 * Fold durable layouts into the session snapshot.
 *
 * Returns true when the snapshot changed. A corrupt payload leaves the local
 * snapshot untouched; a stale remote variant can never outrank a local
 * tombstone or a newer local edit.
 */
export async function hydrateLayoutStoreFromPlatform(platform: Platform): Promise<boolean> {
  attachLayoutStorePlatform(platform);
  let raw: string | null = null;
  try {
    raw = await platform.getAppSetting(APP_SETTING_KEY);
  } catch (err) {
    recordPersistenceError('platform', err);
    return false;
  }
  if (!raw) return false;

  let remote: WorkspaceLayoutStoreState;
  try {
    remote = sanitizeLayoutStore(JSON.parse(raw));
  } catch (err) {
    recordPersistenceError('platform', err);
    return false;
  }

  const local = getLayoutStore();
  const merged = mergeLayoutStores(local, remote);
  if (layoutStoresEquivalent(merged, local)) return false;
  setLayoutStore(merged);
  return true;
}

/** Content equality ignoring the revision counter. */
function layoutStoresEquivalent(
  a: WorkspaceLayoutStoreState,
  b: WorkspaceLayoutStoreState,
): boolean {
  return (
    JSON.stringify(a.variants) === JSON.stringify(b.variants) &&
    JSON.stringify(a.tombstones) === JSON.stringify(b.tombstones) &&
    JSON.stringify(a.resetSnapshot ?? null) === JSON.stringify(b.resetSnapshot ?? null)
  );
}
