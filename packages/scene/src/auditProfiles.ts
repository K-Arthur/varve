/**
 * Workspace-aware audit profiles — defines which audit categories and rules
 * are prioritized, shown, or hidden for each workspace mode.
 *
 * Each profile specifies:
 * - primaryCategories: shown at top of audit panel, run as immediate rules
 * - secondaryCategories: available but not primary
 * - hiddenCategories: not shown in this workspace
 * - defaultStage: which execution stage is default for this workspace
 * - maxFindings: UI cap to avoid overwhelming users
 * - contextualSummaryRules: rules that show L2 contextual summaries in inspector
 *
 * Design principle: "surface what matters, hide what distracts."
 * Print users should see bleed/DPI/font issues prominently.
 * Photo users should see resolution/mask/color-profile prominently.
 * Prototype users should see unreachable screens/dead-ends prominently.
 */

import type { FindingCategory, WorkspaceMode } from './auditFinding';

export interface WorkspaceAuditProfile {
  /** Workspace this profile applies to. */
  workspace: WorkspaceMode;
  /** Audit categories shown prominently (top of panel, immediate stage). */
  primaryCategories: FindingCategory[];
  /** Audit categories available but not primary. */
  secondaryCategories: FindingCategory[];
  /** Audit categories hidden entirely. */
  hiddenCategories: FindingCategory[];
  /** Default execution stage for this workspace. */
  defaultStage: 'immediate' | 'debounced' | 'on-demand';
  /** Max findings to display in the panel (overflow shows "N more..."). */
  maxFindings: number;
  /** Rules that show contextual summaries in the inspector (L2 exposure). */
  contextualSummaryRules: string[];
  /** Status bar badge categories (L1 exposure). */
  statusBadgeCategories: FindingCategory[];
  /** Canvas overlay categories. */
  overlayCategories: FindingCategory[];
}

// ---------------------------------------------------------------------------
// Default profiles
// ---------------------------------------------------------------------------

export const WORKSPACE_AUDIT_PROFILES: Record<WorkspaceMode, WorkspaceAuditProfile> = {
  design: {
    workspace: 'design',
    primaryCategories: ['accessibility', 'color', 'typography', 'structure'],
    secondaryCategories: [
      'layout',
      'spacing',
      'layer-hygiene',
      'governance',
      'performance',
      'vector',
      'prototype',
    ],
    hiddenCategories: ['print', 'raster'],
    defaultStage: 'debounced',
    maxFindings: 50,
    contextualSummaryRules: ['contrast/aa-fail', 'missing-fonts', 'overset-text', 'zero-size'],
    statusBadgeCategories: ['accessibility', 'color', 'typography'],
    overlayCategories: ['accessibility', 'color', 'layout'],
  },

  print: {
    workspace: 'print',
    primaryCategories: ['print', 'typography', 'color', 'export'],
    secondaryCategories: [
      'accessibility',
      'layout',
      'spacing',
      'governance',
      'raster',
      'structure',
    ],
    hiddenCategories: ['prototype', 'layer-hygiene', 'performance'],
    defaultStage: 'on-demand',
    maxFindings: 75,
    contextualSummaryRules: [
      'print/missing-bleed',
      'print/low-dpi',
      'print/missing-font',
      'print/color-space',
    ],
    statusBadgeCategories: ['print', 'typography'],
    overlayCategories: ['print', 'accessibility'],
  },

  drawing: {
    workspace: 'drawing',
    primaryCategories: ['vector', 'structure', 'layer-hygiene'],
    secondaryCategories: ['color', 'spacing', 'layout', 'performance'],
    hiddenCategories: ['print', 'prototype', 'typography', 'governance', 'export', 'accessibility'],
    defaultStage: 'debounced',
    maxFindings: 40,
    contextualSummaryRules: [
      'vector/open-path',
      'vector/self-intersection',
      'vector/unnecessary-anchors',
    ],
    statusBadgeCategories: ['vector', 'structure'],
    overlayCategories: ['vector'],
  },

  image: {
    workspace: 'image',
    primaryCategories: ['raster', 'color', 'accessibility'],
    secondaryCategories: ['typography', 'effects', 'layer-hygiene', 'structure'],
    hiddenCategories: ['print', 'prototype', 'vector', 'governance', 'export', 'performance'],
    defaultStage: 'debounced',
    maxFindings: 40,
    contextualSummaryRules: [
      'raster/low-resolution',
      'raster/oversized-asset',
      'raster/alpha-fringe',
      'contrast/aa-fail',
    ],
    statusBadgeCategories: ['raster', 'accessibility'],
    overlayCategories: ['raster', 'accessibility'],
  },

  motion: {
    workspace: 'motion',
    primaryCategories: ['prototype', 'performance', 'accessibility'],
    secondaryCategories: ['layout', 'spacing', 'structure', 'color'],
    hiddenCategories: ['print', 'raster', 'vector', 'governance', 'export'],
    defaultStage: 'debounced',
    maxFindings: 40,
    contextualSummaryRules: [
      'prototype/dead-end',
      'prototype/missing-interaction',
      'prototype/inaccessible-control',
    ],
    statusBadgeCategories: ['prototype', 'accessibility'],
    overlayCategories: ['prototype'],
  },
};

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

/** Get the audit profile for a workspace mode. */
export function getAuditProfile(mode: WorkspaceMode): WorkspaceAuditProfile {
  return WORKSPACE_AUDIT_PROFILES[mode];
}

/** Check if a category is primary in a workspace. */
export function isCategoryPrimary(category: FindingCategory, mode: WorkspaceMode): boolean {
  return WORKSPACE_AUDIT_PROFILES[mode].primaryCategories.includes(category);
}

/** Check if a category is hidden in a workspace. */
export function isCategoryHidden(category: FindingCategory, mode: WorkspaceMode): boolean {
  return WORKSPACE_AUDIT_PROFILES[mode].hiddenCategories.includes(category);
}

/** Get categories applicable to a workspace (primary + secondary, not hidden). */
export function getApplicableCategories(mode: WorkspaceMode): FindingCategory[] {
  const profile = WORKSPACE_AUDIT_PROFILES[mode];
  return [...profile.primaryCategories, ...profile.secondaryCategories];
}

/** Get status badge categories for a workspace. */
export function getStatusBadgeCategories(mode: WorkspaceMode): FindingCategory[] {
  return WORKSPACE_AUDIT_PROFILES[mode].statusBadgeCategories;
}

/** Get overlay categories for a workspace. */
export function getOverlayCategories(mode: WorkspaceMode): FindingCategory[] {
  return WORKSPACE_AUDIT_PROFILES[mode].overlayCategories;
}

/**
 * Filter findings to only those applicable to a workspace.
 * Hidden categories are excluded; findings with explicit workspaceApplicable
 * are also filtered.
 */
export function filterFindingsForWorkspace<
  T extends { category: FindingCategory; workspaceApplicable?: WorkspaceMode[] },
>(findings: T[], mode: WorkspaceMode): T[] {
  return findings.filter((f) => {
    if (isCategoryHidden(f.category, mode)) return false;
    if (f.workspaceApplicable && f.workspaceApplicable.length > 0) {
      if (!f.workspaceApplicable.includes(mode)) return false;
    }
    return true;
  });
}

/**
 * Sort findings by workspace priority: primary categories first,
 * then secondary, then remaining.
 */
export function sortFindingsByPriority<T extends { category: FindingCategory }>(
  findings: T[],
  mode: WorkspaceMode,
): T[] {
  const profile = WORKSPACE_AUDIT_PROFILES[mode];
  const primarySet = new Set(profile.primaryCategories);
  const secondarySet = new Set(profile.secondaryCategories);

  return [...findings].sort((a, b) => {
    const aPrimary = primarySet.has(a.category) ? 0 : secondarySet.has(a.category) ? 1 : 2;
    const bPrimary = primarySet.has(b.category) ? 0 : secondarySet.has(b.category) ? 1 : 2;
    return aPrimary - bPrimary;
  });
}
