/**
 * Trusted, in-process Inspector section registry.
 *
 * Render factories and predicates execute in the editor's JavaScript realm.
 * Only bundled host code may call this API. Externally installed packages need
 * an isolated runtime and a separate, data-only contribution contract.
 *
 * Design constraints:
 * - Contribution IDs are scoped by plugin ID (`plugin-id/section-id`)
 * - Broken synchronous renders quarantine the owning plugin
 * - Plugin sections are scoped to declared modes
 * - Registration state is session-local; this is not a package manager
 */
import type { ReactNode } from 'react';
import type { WorkspaceMode } from '../../workspace/workspaceTypes';
import type { SectionCategory } from './sectionRegistry';

// ---------------------------------------------------------------------------
// Contribution metadata
// ---------------------------------------------------------------------------

/** Unique plugin identifier (namespaced, e.g. "com.example.my-plugin"). */
export type PluginId = string;

/** Unique contribution ID within a plugin (e.g. "color-analyzer"). */
export type ContributionId = string;

/** Fully qualified contribution ID: `${pluginId}/${contributionId}`. */
export type QualifiedContributionId = string;

/** Display metadata for a contributed section. */
export interface ContributionDisplay {
  /** Human-readable section title. */
  title: string;
  /** Reserved category for future host grouping. */
  category?: SectionCategory;
  /** Icon name from @varve/ui icon set (reserved metadata). */
  icon?: string;
  /** Tooltip description. */
  description?: string;
}

/** Availability condition for a contributed section. */
export interface ContributionAvailability {
  /** Workspace modes where this section is available. Empty = all modes. */
  modes?: WorkspaceMode[];
  /** Minimum selection count (0 = always, 1 = requires selection, etc.). */
  minSelection?: number;
  /** Required active tool(s). Empty = any tool. */
  tools?: string[];
  /** Custom predicate evaluated at render time. */
  predicate?: (ctx: PluginSectionHostContext) => boolean;
}

/**
 * Callback argument handed to availability predicates and render factories.
 * This summary is deliberately small but does not isolate trusted code.
 */
export interface PluginSectionHostContext {
  selectionCount: number;
  workspaceMode: WorkspaceMode;
  activeTool: string;
}

/** Plugin section contribution definition. */
export interface PluginSectionContribution {
  /** Plugin that owns this contribution. */
  pluginId: PluginId;
  /** Unique contribution ID within the plugin. */
  contributionId: ContributionId;
  /** Target Inspector tab. Only properties is mounted; legacy document maps to it. */
  targetTab: string;
  /** Display metadata. */
  display: ContributionDisplay;
  /**
   * Render factory invoked by the host inside an error boundary. Returning
   * null renders the section shell without a body. The host, not the plugin,
   * owns collapse state, availability, and lifecycle — a throwing factory
   * quarantines its plugin instead of crashing the panel. Event-handler and
   * asynchronous failures are outside React error-boundary coverage.
   */
  render?: (ctx: PluginSectionHostContext) => ReactNode;
  /** Default display order within the tab (lower = higher). Default: 1000. */
  order?: number;
  /** Whether hideContribution may hide this section. Default: true. */
  canHide?: boolean;
  /** Reserved for a future contribution-order control. */
  canReorder?: boolean;
  /** Availability conditions. */
  availability?: ContributionAvailability;
  /** Default expanded state. Default: true. */
  defaultExpanded?: boolean;
}

/** Plugin manifest declaring all contributions. */
export interface PluginManifest {
  /** Unique plugin identifier. */
  id: PluginId;
  /** Human-readable plugin name. */
  name: string;
  /** Plugin version (semver). */
  version: string;
  /** Sections contributed by this plugin. */
  contributions: PluginSectionContribution[];
}

// ---------------------------------------------------------------------------
// Plugin state
// ---------------------------------------------------------------------------

/** Runtime state of a plugin. */
export type PluginStatus = 'active' | 'disabled' | 'error';

/** Runtime state for a plugin. */
export interface PluginState {
  manifest: PluginManifest;
  status: PluginStatus;
  /** First registration timestamp in this editor session. */
  installedAt: number;
  /** Error message if status is 'error'. */
  error?: string;
  /** User-hidden contributions (session-local). */
  hiddenContributions?: QualifiedContributionId[];
}

// ---------------------------------------------------------------------------
// Plugin registry (singleton)
// ---------------------------------------------------------------------------

type ContributionListener = (contributions: PluginSectionContribution[]) => void;

const plugins = new Map<PluginId, PluginState>();
const listeners = new Set<ContributionListener>();

const ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const CORE_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const IDENTIFIER_RE = /^[0-9A-Za-z-]+$/;
const ONLY_DIGITS_RE = /^[0-9]+$/;
const NUMERIC_IDENTIFIER_RE = /^(?:0|[1-9]\d*)$/;

/**
 * SemVer 2.0.0, validated in linear time.
 *
 * The reference SemVer regex nests quantifiers inside a repeated group, and
 * CodeQL flags it as a ReDoS sink (js/redos) reachable from a plugin manifest.
 * The manifest already caps the string at 128 characters, but that is not a
 * bound on exponential backtracking, so the identifiers are validated
 * individually instead.
 */
function isSemver(value: string): boolean {
  const buildIndex = value.indexOf('+');
  const core = buildIndex === -1 ? value : value.slice(0, buildIndex);
  if (buildIndex !== -1 && !isIdentifierList(value.slice(buildIndex + 1), false)) return false;
  const preIndex = core.indexOf('-');
  const main = preIndex === -1 ? core : core.slice(0, preIndex);
  if (!CORE_RE.test(main)) return false;
  if (preIndex === -1) return true;
  return isIdentifierList(core.slice(preIndex + 1), true);
}

/** `dot.separated.identifiers`; numeric ones may not carry leading zeros. */
function isIdentifierList(value: string, numeric: boolean): boolean {
  if (!value) return false;
  for (const identifier of value.split('.')) {
    if (!identifier || !IDENTIFIER_RE.test(identifier)) return false;
    if (numeric && ONLY_DIGITS_RE.test(identifier) && !NUMERIC_IDENTIFIER_RE.test(identifier)) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 128 || !ID_RE.test(value)) {
    throw new Error(`${label} must be a lowercase dot/hyphen-separated ID (max 128 characters)`);
  }
}

function normalizeTargetTab(tab: unknown): 'properties' {
  if (tab === 'properties' || tab === 'document') return 'properties';
  throw new Error(`Unsupported Inspector plugin target tab: ${String(tab)}`);
}

function cloneContribution(contrib: PluginSectionContribution): PluginSectionContribution {
  return {
    pluginId: contrib.pluginId,
    contributionId: contrib.contributionId,
    targetTab: contrib.targetTab,
    display: { ...contrib.display },
    render: contrib.render,
    order: contrib.order,
    canHide: contrib.canHide,
    canReorder: contrib.canReorder,
    defaultExpanded: contrib.defaultExpanded,
    availability: contrib.availability
      ? {
          minSelection: contrib.availability.minSelection,
          predicate: contrib.availability.predicate,
          modes: contrib.availability.modes && [...contrib.availability.modes],
          tools: contrib.availability.tools && [...contrib.availability.tools],
        }
      : undefined,
  };
}

function cloneManifest(manifest: PluginManifest): PluginManifest {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    contributions: manifest.contributions.map(cloneContribution),
  };
}

function cloneState(state: PluginState): PluginState {
  return {
    ...state,
    manifest: cloneManifest(state.manifest),
    hiddenContributions: state.hiddenContributions && [...state.hiddenContributions],
  };
}

function validateManifest(manifest: PluginManifest): PluginManifest {
  if (!isRecord(manifest)) throw new Error('Plugin manifest must be an object');
  assertId(manifest.id, 'Plugin ID');
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 128) {
    throw new Error('Plugin name must be non-empty and at most 128 characters');
  }
  if (
    typeof manifest.version !== 'string' ||
    manifest.version.length > 128 ||
    !isSemver(manifest.version)
  ) {
    throw new Error('Plugin version must be valid SemVer');
  }
  if (!Array.isArray(manifest.contributions)) {
    throw new Error('Plugin contributions must be an array');
  }
  const ids = new Set<string>();
  const normalized: PluginSectionContribution[] = [];
  for (const contrib of manifest.contributions) {
    if (!isRecord(contrib)) throw new Error('Plugin contribution must be an object');
    if (contrib.pluginId !== manifest.id)
      throw new Error('Contribution owner must match manifest ID');
    assertId(contrib.contributionId, 'Contribution ID');
    if (ids.has(contrib.contributionId))
      throw new Error(`Duplicate contribution ID: ${contrib.contributionId}`);
    ids.add(contrib.contributionId);
    const targetTab = normalizeTargetTab(contrib.targetTab);
    if (
      !isRecord(contrib.display) ||
      typeof contrib.display.title !== 'string' ||
      !contrib.display.title.trim()
    ) {
      throw new Error(`Contribution ${contrib.contributionId} needs a display title`);
    }
    if (
      contrib.order !== undefined &&
      (!Number.isSafeInteger(contrib.order) || !Number.isFinite(contrib.order))
    ) {
      throw new Error(`Contribution ${contrib.contributionId} order must be a safe integer`);
    }
    if (contrib.render !== undefined && typeof contrib.render !== 'function') {
      throw new Error(`Contribution ${contrib.contributionId} render must be a function`);
    }
    if (contrib.availability !== undefined) {
      if (!isRecord(contrib.availability))
        throw new Error(`Contribution ${contrib.contributionId} availability must be an object`);
      if (contrib.availability.modes !== undefined && !Array.isArray(contrib.availability.modes)) {
        throw new Error(`Contribution ${contrib.contributionId} modes must be an array`);
      }
      if (contrib.availability.tools !== undefined && !Array.isArray(contrib.availability.tools)) {
        throw new Error(`Contribution ${contrib.contributionId} tools must be an array`);
      }
      const minSelection = contrib.availability.minSelection;
      if (
        minSelection !== undefined &&
        (typeof minSelection !== 'number' ||
          !Number.isSafeInteger(minSelection) ||
          minSelection < 0)
      ) {
        throw new Error(
          `Contribution ${contrib.contributionId} minSelection must be a nonnegative integer`,
        );
      }
      if (
        contrib.availability.predicate !== undefined &&
        typeof contrib.availability.predicate !== 'function'
      ) {
        throw new Error(`Contribution ${contrib.contributionId} predicate must be a function`);
      }
    }
    normalized.push(
      cloneContribution({ ...(contrib as unknown as PluginSectionContribution), targetTab }),
    );
  }
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    contributions: normalized,
  };
}

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener(getActiveContributions());
    } catch {
      // Listener error — ignore
    }
  }
}

/** Register bundled code. Re-registration preserves disabled/error state. */
export function registerPlugin(manifest: PluginManifest): void {
  const validated = validateManifest(manifest);
  const existing = plugins.get(manifest.id);
  const currentIds = new Set(validated.contributions.map(qualifyContribution));
  plugins.set(manifest.id, {
    manifest: validated,
    status: existing?.status ?? 'active',
    installedAt: existing?.installedAt ?? Date.now(),
    error: existing?.error,
    hiddenContributions: existing?.hiddenContributions?.filter((id) => currentIds.has(id)),
  });
  notifyListeners();
}

/** Unregister a plugin. */
export function unregisterPlugin(pluginId: PluginId): void {
  plugins.delete(pluginId);
  notifyListeners();
}

/** Enable a disabled plugin. Quarantined plugins require explicit retry. */
export function enablePlugin(pluginId: PluginId): void {
  const state = plugins.get(pluginId);
  if (state?.status === 'disabled') {
    state.status = 'active';
    notifyListeners();
  }
}

/** Retry a quarantined trusted plugin after its defect has been addressed. */
export function retryPlugin(pluginId: PluginId): void {
  const state = plugins.get(pluginId);
  if (state?.status !== 'error') return;
  state.status = 'active';
  delete state.error;
  notifyListeners();
}

/** Disable a plugin (sections become invisible but registration persists). */
export function disablePlugin(pluginId: PluginId): void {
  const state = plugins.get(pluginId);
  if (state?.status === 'active') {
    state.status = 'disabled';
    notifyListeners();
  }
}

/** Mark a plugin as errored (e.g. during render). */
export function markPluginError(pluginId: PluginId, error: string): void {
  const state = plugins.get(pluginId);
  if (state?.status === 'active') {
    state.status = 'error';
    state.error = error.slice(0, 500);
    notifyListeners();
  }
}

/** Get all registered plugins. */
export function getRegisteredPlugins(): PluginState[] {
  return Array.from(plugins.values(), cloneState);
}

/** Get active (non-disabled, non-error) contributions. */
export function getActiveContributions(): PluginSectionContribution[] {
  const result: PluginSectionContribution[] = [];
  for (const state of plugins.values()) {
    if (state.status !== 'active') continue;
    for (const contrib of state.manifest.contributions) {
      const qid = `${contrib.pluginId}/${contrib.contributionId}`;
      if (state.hiddenContributions?.includes(qid)) continue;
      result.push(cloneContribution(contrib));
    }
  }
  return result.sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
}

/** Get contributions for a specific tab. */
export function getContributionsForTab(
  tab: PluginSectionContribution['targetTab'],
): PluginSectionContribution[] {
  return getActiveContributions().filter(
    (c) => c.targetTab === (tab === 'document' ? 'properties' : tab),
  );
}

/** Subscribe to contribution changes. */
export function onContributionsChange(listener: ContributionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Check if a contribution is available for the current context. */
export function isContributionAvailable(
  contrib: PluginSectionContribution,
  ctx: {
    selectionCount: number;
    workspaceMode: WorkspaceMode;
    activeTool: string;
  },
): boolean {
  const avail = contrib.availability;
  if (!avail) return true;
  if (avail.modes && avail.modes.length > 0 && !avail.modes.includes(ctx.workspaceMode))
    return false;
  if (avail.minSelection !== undefined && ctx.selectionCount < avail.minSelection) return false;
  if (avail.tools && avail.tools.length > 0 && !avail.tools.includes(ctx.activeTool)) return false;
  if (avail.predicate && !avail.predicate(Object.freeze({ ...ctx }))) return false;
  return true;
}

/** Get the qualified contribution ID. */
export function qualifyContribution(contrib: PluginSectionContribution): QualifiedContributionId {
  return `${contrib.pluginId}/${contrib.contributionId}`;
}

/** Hide a specific contribution for a plugin. */
export function hideContribution(pluginId: PluginId, contributionId: ContributionId): void {
  const state = plugins.get(pluginId);
  if (!state) return;
  const contribution = state.manifest.contributions.find(
    (item) => item.contributionId === contributionId,
  );
  if (!contribution || contribution.canHide === false) return;
  const qid = `${pluginId}/${contributionId}`;
  if (!state.hiddenContributions) state.hiddenContributions = [];
  if (!state.hiddenContributions.includes(qid)) {
    state.hiddenContributions.push(qid);
    notifyListeners();
  }
}

/** Show a previously hidden contribution. */
export function showContribution(pluginId: PluginId, contributionId: ContributionId): void {
  const state = plugins.get(pluginId);
  if (!state?.hiddenContributions) return;
  const qid = `${pluginId}/${contributionId}`;
  state.hiddenContributions = state.hiddenContributions.filter((id) => id !== qid);
  notifyListeners();
}

// ---------------------------------------------------------------------------
// Error boundary helpers
// ---------------------------------------------------------------------------

/** Boundary result for wrapping plugin section rendering. */
export interface PluginRenderResult {
  ok: boolean;
  error?: string;
}

/** Safely evaluate a plugin section's availability. Returns error if predicate throws. */
export function safeCheckAvailability(
  contrib: PluginSectionContribution,
  ctx: Parameters<typeof isContributionAvailable>[1],
): PluginRenderResult {
  try {
    const available = isContributionAvailable(contrib, ctx);
    return available ? { ok: true } : { ok: false };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
