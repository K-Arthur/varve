/**
 * TDD tests for workspace-aware audit profiles.
 *
 * Tests: profile structure, category filtering, priority sorting,
 * finding filtering, and status badge/overlay categories.
 */
import { describe, expect, it } from 'vitest';
import type { WorkspaceMode } from './auditFinding';
import { createFinding } from './auditFinding';
import {
  filterFindingsForWorkspace,
  getApplicableCategories,
  getAuditProfile,
  getOverlayCategories,
  getStatusBadgeCategories,
  isCategoryHidden,
  isCategoryPrimary,
  sortFindingsByPriority,
  WORKSPACE_AUDIT_PROFILES,
} from './auditProfiles';

describe('workspace audit profiles', () => {
  it('has profiles for all 6 workspace modes', () => {
    const modes: WorkspaceMode[] = ['design', 'print', 'drawing', 'image', 'motion', 'codegen'];
    for (const mode of modes) {
      expect(WORKSPACE_AUDIT_PROFILES[mode]).toBeDefined();
      expect(WORKSPACE_AUDIT_PROFILES[mode].workspace).toBe(mode);
    }
  });

  it('design profile prioritizes accessibility, color, typography, structure', () => {
    const profile = getAuditProfile('design');
    expect(profile.primaryCategories).toContain('accessibility');
    expect(profile.primaryCategories).toContain('color');
    expect(profile.primaryCategories).toContain('typography');
    expect(profile.primaryCategories).toContain('structure');
    expect(profile.hiddenCategories).toContain('print');
    expect(profile.hiddenCategories).toContain('raster');
  });

  it('print profile prioritizes print, typography, color, export', () => {
    const profile = getAuditProfile('print');
    expect(profile.primaryCategories).toContain('print');
    expect(profile.primaryCategories).toContain('typography');
    expect(profile.primaryCategories).toContain('color');
    expect(profile.primaryCategories).toContain('export');
    expect(profile.hiddenCategories).toContain('prototype');
  });

  it('drawing profile prioritizes vector, structure, layer-hygiene', () => {
    const profile = getAuditProfile('drawing');
    expect(profile.primaryCategories).toContain('vector');
    expect(profile.primaryCategories).toContain('structure');
    expect(profile.hiddenCategories).toContain('print');
    expect(profile.hiddenCategories).toContain('prototype');
  });

  it('image profile prioritizes raster, color, accessibility', () => {
    const profile = getAuditProfile('image');
    expect(profile.primaryCategories).toContain('raster');
    expect(profile.primaryCategories).toContain('color');
    expect(profile.hiddenCategories).toContain('print');
    expect(profile.hiddenCategories).toContain('vector');
  });

  it('motion profile prioritizes prototype, performance, accessibility', () => {
    const profile = getAuditProfile('motion');
    expect(profile.primaryCategories).toContain('prototype');
    expect(profile.primaryCategories).toContain('performance');
    expect(profile.hiddenCategories).toContain('print');
    expect(profile.hiddenCategories).toContain('raster');
  });

  it('codegen profile prioritizes codegen, structure, governance, accessibility', () => {
    const profile = getAuditProfile('codegen');
    expect(profile.primaryCategories).toContain('codegen');
    expect(profile.primaryCategories).toContain('structure');
    expect(profile.primaryCategories).toContain('governance');
    expect(profile.primaryCategories).toContain('accessibility');
    expect(profile.hiddenCategories).toContain('print');
    expect(profile.hiddenCategories).toContain('prototype');
  });

  it('every profile has contextualSummaryRules', () => {
    for (const mode of Object.values(WORKSPACE_AUDIT_PROFILES)) {
      expect(mode.contextualSummaryRules.length).toBeGreaterThan(0);
    }
  });

  it('every profile has statusBadgeCategories', () => {
    for (const mode of Object.values(WORKSPACE_AUDIT_PROFILES)) {
      expect(mode.statusBadgeCategories.length).toBeGreaterThan(0);
    }
  });

  it('every profile has overlayCategories', () => {
    for (const mode of Object.values(WORKSPACE_AUDIT_PROFILES)) {
      expect(mode.overlayCategories.length).toBeGreaterThan(0);
    }
  });
});

describe('isCategoryPrimary', () => {
  it('returns true for primary categories', () => {
    expect(isCategoryPrimary('accessibility', 'design')).toBe(true);
    expect(isCategoryPrimary('print', 'print')).toBe(true);
    expect(isCategoryPrimary('vector', 'drawing')).toBe(true);
  });

  it('returns false for non-primary categories', () => {
    expect(isCategoryPrimary('print', 'design')).toBe(false);
    expect(isCategoryPrimary('prototype', 'design')).toBe(false);
  });
});

describe('isCategoryHidden', () => {
  it('returns true for hidden categories', () => {
    expect(isCategoryHidden('print', 'design')).toBe(true);
    expect(isCategoryHidden('prototype', 'drawing')).toBe(true);
  });

  it('returns false for non-hidden categories', () => {
    expect(isCategoryHidden('color', 'design')).toBe(false);
    expect(isCategoryHidden('accessibility', 'design')).toBe(false);
  });
});

describe('getApplicableCategories', () => {
  it('returns primary + secondary for a workspace', () => {
    const cats = getApplicableCategories('design');
    expect(cats).toContain('accessibility');
    expect(cats).toContain('color');
    expect(cats).toContain('layout');
    expect(cats).not.toContain('print');
    expect(cats).not.toContain('raster');
  });
});

describe('filterFindingsForWorkspace', () => {
  it('removes findings with hidden categories', () => {
    const findings = [
      createFinding({
        ruleId: 'r1',
        category: 'color',
        severity: 'warning',
        message: 'ok',
        source: 'manual',
      }),
      createFinding({
        ruleId: 'r2',
        category: 'print',
        severity: 'error',
        message: 'no',
        source: 'manual',
      }),
      createFinding({
        ruleId: 'r3',
        category: 'raster',
        severity: 'warning',
        message: 'no',
        source: 'manual',
      }),
    ];
    const filtered = filterFindingsForWorkspace(findings, 'design');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.category).toBe('color');
  });

  it('filters by workspaceApplicable when set', () => {
    const findings = [
      createFinding({
        ruleId: 'r1',
        category: 'color',
        severity: 'warning',
        message: 'design only',
        source: 'manual',
        workspaceApplicable: ['design'],
      }),
      createFinding({
        ruleId: 'r2',
        category: 'color',
        severity: 'warning',
        message: 'print only',
        source: 'manual',
        workspaceApplicable: ['print'],
      }),
    ];
    const filtered = filterFindingsForWorkspace(findings, 'design');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.message).toBe('design only');
  });

  it('keeps findings with empty workspaceApplicable', () => {
    const findings = [
      createFinding({
        ruleId: 'r1',
        category: 'color',
        severity: 'warning',
        message: 'all',
        source: 'manual',
      }),
    ];
    const filtered = filterFindingsForWorkspace(findings, 'design');
    expect(filtered).toHaveLength(1);
  });
});

describe('sortFindingsByPriority', () => {
  it('sorts primary categories first', () => {
    const findings = [
      createFinding({
        ruleId: 'r1',
        category: 'spacing',
        severity: 'warning',
        message: 'secondary',
        source: 'manual',
      }),
      createFinding({
        ruleId: 'r2',
        category: 'accessibility',
        severity: 'error',
        message: 'primary',
        source: 'manual',
      }),
      createFinding({
        ruleId: 'r3',
        category: 'color',
        severity: 'warning',
        message: 'primary',
        source: 'manual',
      }),
      createFinding({
        ruleId: 'r4',
        category: 'print',
        severity: 'error',
        message: 'hidden',
        source: 'manual',
      }),
    ];
    const sorted = sortFindingsByPriority(findings, 'design');
    expect(sorted[0]!.category).toBe('accessibility');
    expect(sorted[1]!.category).toBe('color');
    expect(sorted[2]!.category).toBe('spacing');
    expect(sorted[3]!.category).toBe('print');
  });
});

describe('getStatusBadgeCategories', () => {
  it('returns status badge categories for design', () => {
    const cats = getStatusBadgeCategories('design');
    expect(cats).toContain('accessibility');
    expect(cats).toContain('color');
  });

  it('returns status badge categories for print', () => {
    const cats = getStatusBadgeCategories('print');
    expect(cats).toContain('print');
    expect(cats).toContain('typography');
  });
});

describe('getOverlayCategories', () => {
  it('returns overlay categories for each workspace', () => {
    expect(getOverlayCategories('design')).toContain('accessibility');
    expect(getOverlayCategories('drawing')).toContain('vector');
    expect(getOverlayCategories('image')).toContain('raster');
    expect(getOverlayCategories('print')).toContain('print');
    expect(getOverlayCategories('motion')).toContain('prototype');
  });
});
