/**
 * Plugin Section Contribution API — safe, namespaced extension point for
 * third-party panel sections.
 *
 * Plugins contribute sections via a declarative registration, never by
 * injecting React components directly into the inspector. The host
 * resolves availability, wraps contributions in error boundaries, and
 * manages lifecycle (install/remove/disable).
 *
 * Design constraints:
 * - Plugin IDs are namespaced (`plugin-id/section-id`) to prevent collisions
 * - Contributions declare metadata only; rendering is via a factory function
 * - Broken plugin sections never crash the inspector
 * - Plugin sections are scoped to declared modes
 * - All state is managed by the host, not the plugin
 *
 * Research basis: VS Code extension API, Figma plugin API, Web Components.
 */
import type { WorkspaceMode } from '../workspace/workspaceTypes';
import type { SectionCategory, SectionId } from './sectionRegistry';

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
  /** Category for grouping in the management UI. Falls back to 'advanced'. */
  category?: SectionCategory;
  /** Icon name from @strata/ui icon set. */
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
  predicate?: (ctx: {
    selectionCount: number;
    workspaceMode: WorkspaceMode;
    activeTool: string;
  }) => boolean;
}

/** Plugin section contribution definition. */
export interface PluginSectionContribution {
  /** Plugin that owns this contribution. */
  pluginId: PluginId;
  /** Unique contribution ID within the plugin. */
  contributionId: ContributionId;
  /** Target inspector tab. */
  targetTab: 'properties' | 'export' | 'spec' | 'score' | 'audit';
  /** Display metadata. */
  display: ContributionDisplay;
  /** Default display order within the tab (lower = higher). Default: 1000. */
  order?: number;
  /** Whether the user can hide this section. Default: true. */
  canHide?: boolean;
  /** Whether the user can reorder this section. Default: true. */
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
export type PluginStatus = 'active' | 'disabled' | 'error' | 'uninstalled';

/** Runtime state for a plugin. */
export interface PluginState {
  manifest: PluginManifest;
  status: PluginStatus;
  /** Timestamp of last install/update. */
  installedAt: number;
  /** Error message if status is 'error'. */
  error?: string;
  /** User-hidden contributions (overrides the contribution's canHide). */
  hiddenContributions?: QualifiedContributionId[];
}

// ---------------------------------------------------------------------------
// Plugin registry (singleton)
// ---------------------------------------------------------------------------

type ContributionListener = (contributions: PluginSectionContribution[]) => void;

const plugins = new Map<PluginId, PluginState>();
const listeners = new Set<ContributionListener>();

function notifyListeners() {
  const all = getActiveContributions();
  for (const listener of listeners) {
    try {
      listener(all);
    } catch {
      // Listener error — ignore
    }
  }
}

/** Register a plugin manifest. Idempotent — re-registering updates the manifest. */
export function registerPlugin(manifest: PluginManifest): void {
  const existing = plugins.get(manifest.id);
  plugins.set(manifest.id, {
    manifest,
    status: existing?.status === 'disabled' ? 'disabled' : 'active',
    installedAt: existing?.installedAt ?? Date.now(),
    hiddenContributions: existing?.hiddenContributions,
  });
  notifyListeners();
}

/** Unregister a plugin. */
export function unregisterPlugin(pluginId: PluginId): void {
  plugins.delete(pluginId);
  notifyListeners();
}

/** Enable a disabled plugin. */
export function enablePlugin(pluginId: PluginId): void {
  const state = plugins.get(pluginId);
  if (state && state.status !== 'active') {
    state.status = 'active';
    notifyListeners();
  }
}

/** Disable a plugin (sections become invisible but registration persists). */
export function disablePlugin(pluginId: PluginId): void {
  const state = plugins.get(pluginId);
  if (state) {
    state.status = 'disabled';
    notifyListeners();
  }
}

/** Mark a plugin as errored (e.g. during render). */
export function markPluginError(pluginId: PluginId, error: string): void {
  const state = plugins.get(pluginId);
  if (state) {
    state.status = 'error';
    state.error = error;
    notifyListeners();
  }
}

/** Get all registered plugins. */
export function getRegisteredPlugins(): PluginState[] {
  return Array.from(plugins.values());
}

/** Get active (non-disabled, non-error) contributions. */
export function getActiveContributions(): PluginSectionContribution[] {
  const result: PluginSectionContribution[] = [];
  for (const state of plugins.values()) {
    if (state.status !== 'active') continue;
    for (const contrib of state.manifest.contributions) {
      const qid = `${contrib.pluginId}/${contrib.contributionId}`;
      if (state.hiddenContributions?.includes(qid)) continue;
      result.push(contrib);
    }
  }
  return result.sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
}

/** Get contributions for a specific tab. */
export function getContributionsForTab(
  tab: PluginSectionContribution['targetTab'],
): PluginSectionContribution[] {
  return getActiveContributions().filter((c) => c.targetTab === tab);
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
  if (avail.modes && !avail.modes.includes(ctx.workspaceMode)) return false;
  if (avail.minSelection !== undefined && ctx.selectionCount < avail.minSelection) return false;
  if (avail.tools && avail.tools.length > 0 && !avail.tools.includes(ctx.activeTool)) return false;
  if (avail.predicate && !avail.predicate(ctx)) return false;
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
