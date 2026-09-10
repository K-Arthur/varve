/**
 * Audit adapter — bridges existing audit sources to the unified AuditFinding model
 * and registers all built-in rules with the registry.
 *
 * This module:
 * 1. Wraps existing pure-function audit sources as AuditRuleDef entries
 * 2. Maps legacy severity/category to unified types
 * 3. Provides the defaultRuleRegistry() initializer
 *
 * Call `registerBuiltinRules()` once on editor startup to populate the registry.
 */

import type { WorkspaceMode } from '@varve/shared';
import type { AuditContext, AuditRuleDef } from './auditEngine';
import { registerRule } from './auditEngine';
import type { AuditSeverity, FindingCategory } from './auditFinding';
import { createFinding } from './auditFinding';
import { walkNodes } from './document';
import { runIntelligenceAudit } from './intelligence/audit';
import { runDebtScan } from './intelligence/debtScanner';
import { runGovernanceRules } from './intelligence/governanceRules';
import { runLinterScan } from './intelligence/linterScanner';

// ---------------------------------------------------------------------------
// Legacy severity mapping
// ---------------------------------------------------------------------------

function mapSeverity(s: 'error' | 'warning' | 'info' | 'suggestion'): AuditSeverity {
  switch (s) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'suggestion':
      return 'suggestion';
    case 'info':
      return 'advisory';
  }
}

// ---------------------------------------------------------------------------
// Built-in rule definitions
// ---------------------------------------------------------------------------

function createBuiltinRules(): AuditRuleDef[] {
  return [
    // ---- WCAG Text Contrast ----
    {
      id: 'contrast/aa-fail',
      label: 'WCAG Text Contrast',
      category: 'accessibility',
      source: 'wcag-contrast',
      defaultSeverity: 'warning',
      cost: 'moderate',
      stage: 'debounced',
      workspaces: [], // all workspaces
      nodeKinds: ['text'],
      blocking: false,
      contextDependent: true,
      confidenceFloor: 0.7,
      suppressible: true,
      run: (ctx) => {
        const legacyIssues = runIntelligenceAudit(ctx.doc);
        return legacyIssues.map((issue) =>
          createFinding({
            ruleId: issue.type,
            category: 'accessibility',
            severity: mapSeverity(issue.severity),
            message: issue.message,
            nodeId: issue.nodeId,
            source: 'wcag-contrast',
            cost: 'moderate',
            contextDependent: true,
            confidence: 0.9,
            autoFixAvailable: !!issue.autoFix,
          }),
        );
      },
    },

    // ---- Debt Scanner (aggregated) ----
    ...createDebtScannerRules(),

    // ---- Linter Rules ----
    ...createLinterRules(),

    // ---- Governance Rules ----
    ...createGovernanceRules(),

    // ---- Logo Rules ----
    ...createLogoRules(),
  ];
}

function createDebtScannerRules(): AuditRuleDef[] {
  const checks: Array<{
    id: string;
    label: string;
    category: FindingCategory;
    stage: AuditRuleDef['stage'];
    cost: AuditRuleDef['cost'];
  }> = [
    {
      id: 'untokenized-colors',
      label: 'Untokenized Colors',
      category: 'color',
      stage: 'debounced',
      cost: 'cheap',
    },
    {
      id: 'inline-spacing',
      label: 'Inline Spacing',
      category: 'spacing',
      stage: 'debounced',
      cost: 'cheap',
    },
    {
      id: 'naming-violations',
      label: 'Naming Violations',
      category: 'governance',
      stage: 'debounced',
      cost: 'cheap',
    },
    {
      id: 'orphan-styles',
      label: 'Orphaned Styles',
      category: 'governance',
      stage: 'on-demand',
      cost: 'moderate',
    },
    {
      id: 'unused-components',
      label: 'Unused Components',
      category: 'governance',
      stage: 'on-demand',
      cost: 'moderate',
    },
    {
      id: 'missing-fonts',
      label: 'Missing Fonts',
      category: 'typography',
      stage: 'immediate',
      cost: 'cheap',
    },
    {
      id: 'duplicate-styles',
      label: 'Duplicate Styles',
      category: 'governance',
      stage: 'on-demand',
      cost: 'moderate',
    },
    {
      id: 'inconsistent-radius',
      label: 'Inconsistent Radius',
      category: 'layout',
      stage: 'debounced',
      cost: 'cheap',
    },
    {
      id: 'hardcoded-font-sizes',
      label: 'Hardcoded Font Sizes',
      category: 'typography',
      stage: 'on-demand',
      cost: 'cheap',
    },
    {
      id: 'mixed-color-spaces',
      label: 'Mixed Color Spaces',
      category: 'color',
      stage: 'immediate',
      cost: 'cheap',
    },
    {
      id: 'low-contrast',
      label: 'Low Contrast Text',
      category: 'accessibility',
      stage: 'immediate',
      cost: 'moderate',
    },
    {
      id: 'overset-text',
      label: 'Overset Text',
      category: 'typography',
      stage: 'debounced',
      cost: 'cheap',
    },
    {
      id: 'unnamed-layers',
      label: 'Unnamed Layers',
      category: 'layer-hygiene',
      stage: 'on-demand',
      cost: 'cheap',
    },
    {
      id: 'excessive-nesting',
      label: 'Excessive Nesting',
      category: 'structure',
      stage: 'debounced',
      cost: 'cheap',
    },
    {
      id: 'missing-export-presets',
      label: 'Missing Export Presets',
      category: 'export',
      stage: 'on-demand',
      cost: 'cheap',
    },
  ];

  return checks.map((check) => ({
    id: `debt/${check.id}`,
    label: check.label,
    category: check.category,
    source: 'debt-scanner' as const,
    defaultSeverity: 'warning' as AuditSeverity,
    cost: check.cost,
    stage: check.stage,
    workspaces: [] as const,
    nodeKinds: [],
    blocking: check.id === 'missing-fonts',
    contextDependent: true,
    confidenceFloor: 0.6,
    suppressible: true,
    run: (ctx: AuditContext) => {
      const report = runDebtScan(ctx.doc, {
        availableFonts: ctx.availableFonts,
      });
      const matchingIssues = report.issues.filter((issue) => issue.checkId === check.id);
      return matchingIssues.map((issue) =>
        createFinding({
          ruleId: `debt/${check.id}`,
          category: check.category,
          severity: mapSeverity(issue.severity),
          message: issue.message,
          nodeId: issue.nodeId,
          autoFixAvailable: issue.fixable,
          source: 'debt-scanner',
          cost: check.cost,
          contextDependent: true,
          confidence: issue.fixable ? 0.9 : 0.7,
        }),
      );
    },
  }));
}

function createLinterRules(): AuditRuleDef[] {
  const checks: Array<{
    id: string;
    label: string;
    category: FindingCategory;
    cost: AuditRuleDef['cost'];
  }> = [
    { id: 'zero-size', label: 'Zero-Size Layers', category: 'layer-hygiene', cost: 'cheap' },
    { id: 'off-canvas', label: 'Off-Canvas Layers', category: 'layer-hygiene', cost: 'cheap' },
    { id: 'empty-container', label: 'Empty Containers', category: 'layer-hygiene', cost: 'cheap' },
    {
      id: 'non-text-contrast',
      label: 'Non-Text Contrast',
      category: 'accessibility',
      cost: 'moderate',
    },
    { id: 'touch-target', label: 'Touch Target Size', category: 'touch-target', cost: 'moderate' },
    { id: 'focus-order', label: 'Focus Order', category: 'focus-order', cost: 'moderate' },
  ];

  return checks.map((check) => ({
    id: `linter/${check.id}`,
    label: check.label,
    category: check.category,
    source: 'linter' as const,
    defaultSeverity: 'warning' as AuditSeverity,
    cost: check.cost,
    stage: 'debounced' as const,
    workspaces: [] as const,
    nodeKinds: [],
    blocking: false,
    contextDependent: false,
    confidenceFloor: 0.5,
    suppressible: true,
    run: (ctx: AuditContext) => {
      const report = runLinterScan(ctx.doc, {
        availableFonts: ctx.availableFonts,
        viewport: ctx.viewport,
      });
      const matchingIssues = report.issues.filter((issue) => issue.ruleId.includes(check.id));
      return matchingIssues.map((issue) =>
        createFinding({
          ruleId: `linter/${check.id}`,
          category: check.category,
          severity: mapSeverity(issue.severity),
          message: issue.message,
          nodeId: issue.nodeIds?.[0],
          confidence: issue.confidence ?? 0.8,
          source: 'linter',
          cost: check.cost,
          contextDependent: false,
        }),
      );
    },
  }));
}

function createGovernanceRules(): AuditRuleDef[] {
  const checks: Array<{
    id: string;
    label: string;
    category: FindingCategory;
  }> = [
    { id: 'token-color', label: 'Token Colors', category: 'color' },
    { id: 'spacing-token', label: 'Spacing Tokens', category: 'spacing' },
    { id: 'naming', label: 'Naming Conventions', category: 'governance' },
    { id: 'orphan', label: 'Orphaned Assets', category: 'governance' },
    { id: 'font', label: 'Font Availability', category: 'typography' },
  ];

  return checks.map((check) => ({
    id: `governance/${check.id}`,
    label: check.label,
    category: check.category,
    source: 'governance' as const,
    defaultSeverity: 'warning' as AuditSeverity,
    cost: 'moderate' as const,
    stage: 'on-demand' as const,
    workspaces: [] as const,
    nodeKinds: [],
    blocking: check.id === 'font',
    contextDependent: true,
    confidenceFloor: 0.7,
    suppressible: true,
    run: (ctx: AuditContext) => {
      const issues = runGovernanceRules(ctx.doc, {
        availableFonts: ctx.availableFonts,
      });
      const matchingIssues = issues.filter((issue) => issue.ruleId === check.id);
      return matchingIssues.map((issue) =>
        createFinding({
          ruleId: `governance/${check.id}`,
          category: check.category,
          severity: mapSeverity(issue.severity),
          message: issue.message,
          nodeId: issue.nodeId,
          source: 'governance',
          cost: 'moderate',
          contextDependent: true,
          confidence: 0.8,
        }),
      );
    },
  }));
}

// ---------------------------------------------------------------------------
// Logo rules (advisory)
// ---------------------------------------------------------------------------

/**
 * Logo-specific advisory rules. These are technical checks for logo
 * deliverables: they never block export and never pretend to score design
 * quality. Each finding explains the risk, names the affected nodes, and
 * suggests a fix. Rules only fire when the document carries a logo project
 * (doc.logoProject) or when the user is in the logo workspace.
 */
function createLogoRules(): AuditRuleDef[] {
  const logoWorkspaces: WorkspaceMode[] = ['logo', 'design', 'print', 'drawing'];
  return [
    {
      id: 'logo/text-left-editable',
      label: 'Editable text in logo artwork',
      category: 'typography',
      source: 'logo',
      defaultSeverity: 'advisory',
      cost: 'cheap',
      stage: 'debounced',
      workspaces: logoWorkspaces,
      nodeKinds: ['text'],
      blocking: false,
      contextDependent: false,
      confidenceFloor: 0.8,
      suppressible: true,
      run: (ctx) => {
        if (!ctx.doc.logoProject) return [];
        return [...walkNodes(ctx.doc).values()]
          .filter((entry) => {
            const node = entry.node;
            return node.kind === 'text' && node.text !== undefined && node.text.length > 0;
          })
          .map((entry) =>
            createFinding({
              ruleId: 'logo/text-left-editable',
              category: 'typography',
              severity: 'advisory',
              message:
                'Text is still editable in the logo artwork. Outline the text before final delivery so exports never depend on the font.',
              nodeId: entry.nodeId,
              source: 'logo',
              cost: 'cheap',
              contextDependent: false,
              confidence: 0.9,
            }),
          );
      },
    },
    {
      id: 'logo/thin-strokes',
      label: 'Very thin strokes',
      category: 'vector',
      source: 'logo',
      defaultSeverity: 'warning',
      cost: 'cheap',
      stage: 'debounced',
      workspaces: logoWorkspaces,
      nodeKinds: ['shape'],
      blocking: false,
      contextDependent: false,
      confidenceFloor: 0.8,
      suppressible: true,
      run: (ctx) => {
        if (!ctx.doc.logoProject) return [];
        return [...walkNodes(ctx.doc).values()]
          .filter((entry) => {
            const node = entry.node;
            if (node.kind !== 'shape') return false;
            const stroke = node.strokes?.find((s) => s.visible);
            return stroke !== undefined && stroke.weight > 0 && stroke.weight < 2;
          })
          .map((entry) =>
            createFinding({
              ruleId: 'logo/thin-strokes',
              category: 'vector',
              severity: 'warning',
              message:
                'Stroke thinner than 2px may disappear at small sizes or when printed. Expand the stroke or thicken it for the small variant.',
              nodeId: entry.nodeId,
              source: 'logo',
              cost: 'cheap',
              contextDependent: false,
              confidence: 0.85,
            }),
          );
      },
    },
    {
      id: 'logo/excessive-points',
      label: 'Excessively complex path',
      category: 'vector',
      source: 'logo',
      defaultSeverity: 'advisory',
      cost: 'moderate',
      stage: 'on-demand',
      workspaces: logoWorkspaces,
      nodeKinds: ['shape'],
      blocking: false,
      contextDependent: false,
      confidenceFloor: 0.8,
      suppressible: true,
      run: (ctx) => {
        if (!ctx.doc.logoProject) return [];
        const MAX_POINTS = 2000;
        return [...walkNodes(ctx.doc).values()]
          .filter((entry) => {
            const node = entry.node;
            return (
              node.kind === 'shape' &&
              node.shape.kind === 'path' &&
              node.shape.points.length > MAX_POINTS
            );
          })
          .map((entry) => {
            const node = entry.node;
            return createFinding({
              ruleId: 'logo/excessive-points',
              category: 'vector',
              severity: 'advisory',
              message:
                'Path has ' +
                (node.kind === 'shape' && node.shape.kind === 'path'
                  ? String(node.shape.points.length)
                  : 'many') +
                ' anchor points — this hurts editing, export, and small-size rendering. Run Object → Simplify Path.',
              nodeId: entry.nodeId,
              source: 'logo',
              cost: 'moderate',
              contextDependent: false,
              confidence: 0.9,
            });
          });
      },
    },
    {
      id: 'logo/missing-monochrome-variant',
      label: 'Missing monochrome variant',
      category: 'export',
      source: 'logo',
      defaultSeverity: 'advisory',
      cost: 'cheap',
      stage: 'debounced',
      workspaces: logoWorkspaces,
      nodeKinds: [],
      blocking: false,
      contextDependent: false,
      confidenceFloor: 0.8,
      suppressible: true,
      run: (ctx) => {
        const project = ctx.doc.logoProject;
        if (!project || project.concepts.length === 0) return [];
        const hasMonochrome = project.variants.some(
          (v) => v.kind === 'monochrome' || v.kind === 'reversed',
        );
        if (hasMonochrome) return [];
        return [
          createFinding({
            ruleId: 'logo/missing-monochrome-variant',
            category: 'export',
            severity: 'advisory',
            message:
              'The logo project has no monochrome or reversed variant. Add one (File → Create Monochrome Variant) for fax, engraving, and one-color print.',
            source: 'logo',
            cost: 'cheap',
            contextDependent: false,
            confidence: 0.95,
          }),
        ];
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register all built-in audit rules with the registry.
 * Call once on editor startup (in EditorProvider or Shell mount).
 */
export function registerBuiltinRules(): void {
  const rules = createBuiltinRules();
  for (const rule of rules) {
    registerRule(rule);
  }
}
