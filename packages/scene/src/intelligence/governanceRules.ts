/**
 * Real-time design-system governance rule engine.
 *
 * Scans the document for violations of design-system invariants:
 * tokenized colors, spacing on a grid, naming conventions, orphans,
 * and font availability. Each rule is a pure function returning issues
 * with optional auto-fixes.
 */

import type { ColorSwatch, ManagedColor } from '../colorManagement';
import type { Document } from '../document';
import {
  findOrphanedStyles,
  findUnusedComponents,
  validateComponentProperties,
  validateNamingConventions,
} from '../governance';
import type { FrameNode, NodeId, SceneNode } from '../types';
import type { Variable } from '../variables';

/** Severity of a governance issue. */
export type GovernanceSeverity = 'error' | 'warning' | 'info';

/** A single governance issue discovered by the rule engine. */
export interface GovernanceIssue {
  /** Rule that produced the issue. */
  ruleId: string;
  /** Human-readable severity. */
  severity: GovernanceSeverity;
  /** Human-readable message. */
  message: string;
  /** Affected node id, if applicable. */
  nodeId?: NodeId;
  /** Affected component/style/variable name, if applicable. */
  targetName?: string;
  /** Optional auto-fix producing a new Document. */
  autoFix?: (doc: Document) => Document;
}

/** Options for the governance rule engine. */
export interface GovernanceRulesOptions {
  /** Set of available font families (from FontRegistry). */
  availableFonts?: Set<string>;
  /** Base spacing unit in px (default 4). */
  baseSpacingUnit?: number;
  /** Tolerance for spacing "on-grid" checks in px (default 0.5). */
  spacingTolerance?: number;
  /** Treat a node as a token match when within this deltaEOK distance. */
  colorMatchTolerance?: number;
}

/** Runs all governance rules and returns combined issues. */
export function runGovernanceRules(
  doc: Document,
  opts: GovernanceRulesOptions = {},
): GovernanceIssue[] {
  return [
    ...ruleTokenColors(doc, opts),
    ...ruleSpacingTokens(doc, opts),
    ...ruleNaming(doc),
    ...ruleOrphans(doc),
    ...ruleFonts(doc, opts),
  ];
}

// ── Rule 1: Token Color Rule ───────────────────────────────────────────────

/** True when the color space and channel values match within tolerance. */
function colorsEqual(a: ManagedColor, b: ManagedColor, tolerance: number): boolean {
  if (a.space !== b.space) return false;
  if (a.space === 'rgb' && b.space === 'rgb') {
    return (
      Math.abs(a.r - b.r) <= tolerance &&
      Math.abs(a.g - b.g) <= tolerance &&
      Math.abs(a.b - b.b) <= tolerance &&
      Math.abs(a.a - b.a) <= tolerance
    );
  }
  if (a.space === 'cmyk' && b.space === 'cmyk') {
    return (
      Math.abs(a.c - b.c) <= tolerance &&
      Math.abs(a.m - b.m) <= tolerance &&
      Math.abs(a.y - b.y) <= tolerance &&
      Math.abs(a.k - b.k) <= tolerance &&
      Math.abs(a.a - b.a) <= tolerance
    );
  }
  if (a.space === 'gray' && b.space === 'gray') {
    return Math.abs(a.v - b.v) <= tolerance && Math.abs(a.a - b.a) <= tolerance;
  }
  if (a.space === 'spot' && b.space === 'spot') {
    return a.name.toLowerCase() === b.name.toLowerCase() && a.tint === b.tint;
  }
  return false;
}

function findMatchingSwatch(color: ManagedColor, swatches: ColorSwatch[]): ColorSwatch | undefined {
  const tolerance = 1.5; // 1.5/255 channel tolerance
  return swatches.find((s) => colorsEqual(s.color, color, tolerance));
}

function extractNodeFills(node: SceneNode): ManagedColor[] {
  if (node.paintRefs && node.paintRefs.length > 0) {
    // Paints can't be checked for token membership without Document.paints lookup;
    // paint consumers are skipped for token-color rule (no false positives).
    return [];
  }
  if (node.fills && node.fills.length > 0) {
    return node.fills
      .filter((f) => f.visible !== false && f.type === 'solid' && f.color)
      .map((f) => f.color!);
  }
  // Fallback single fill
  return [node.fill];
}

export function ruleTokenColors(doc: Document, _opts: GovernanceRulesOptions): GovernanceIssue[] {
  const issues: GovernanceIssue[] = [];
  const swatches = doc.swatches ?? [];
  if (swatches.length === 0) return issues;

  for (const node of Object.values(doc.nodes)) {
    const colors = extractNodeFills(node);
    for (const color of colors) {
      if (color.a === 0) continue; // fully transparent, skip
      const match = findMatchingSwatch(color, swatches);
      if (match) continue;
      issues.push({
        ruleId: 'token-color',
        severity: 'warning',
        message: `"${node.name}" uses a color not present in document swatches.`,
        nodeId: node.id,
      });
    }
  }
  return issues;
}

// ── Rule 2: Spacing Token Rule ─────────────────────────────────────────────

function isOnGrid(value: number, base: number, tolerance: number): boolean {
  if (value === 0) return true;
  const ratio = value / base;
  return Math.abs(ratio - Math.round(ratio)) <= tolerance / base;
}

function checkFrameSpacing(
  node: FrameNode,
  base: number,
  tolerance: number,
): GovernanceIssue | undefined {
  const ls = node.layoutStyle;
  if (!ls) return undefined;

  const problems: string[] = [];
  if (!isOnGrid(ls.gap, base, tolerance)) {
    problems.push(`gap ${ls.gap}px`);
  }
  const [pt, pr, pb, pl] = ls.padding;
  if (!isOnGrid(pt, base, tolerance)) problems.push(`padding-top ${pt}px`);
  if (!isOnGrid(pr, base, tolerance)) problems.push(`padding-right ${pr}px`);
  if (!isOnGrid(pb, base, tolerance)) problems.push(`padding-bottom ${pb}px`);
  if (!isOnGrid(pl, base, tolerance)) problems.push(`padding-left ${pl}px`);

  if (problems.length === 0) return undefined;

  return {
    ruleId: 'spacing-token',
    severity: 'warning',
    message: `Frame "${node.name}" has non-grid spacing values: ${problems.join(', ')} (base ${base}px).`,
    nodeId: node.id,
  };
}

export function ruleSpacingTokens(doc: Document, opts: GovernanceRulesOptions): GovernanceIssue[] {
  const issues: GovernanceIssue[] = [];
  const base = opts.baseSpacingUnit ?? 4;
  const tolerance = opts.spacingTolerance ?? 0.5;

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'frame') continue;
    const issue = checkFrameSpacing(node, base, tolerance);
    if (issue) issues.push(issue);
  }
  return issues;
}

// ── Rule 3: Naming Rule ────────────────────────────────────────────────────

function asNodeId(id: string): NodeId {
  return id;
}

export function ruleNaming(doc: Document): GovernanceIssue[] {
  const issues: GovernanceIssue[] = [];

  // Components
  for (const component of Object.values(doc.components)) {
    const result = validateNamingConventions(component.name, 'component');
    for (const issue of result.issues) {
      issues.push({
        ruleId: 'naming',
        severity: issue.type as GovernanceSeverity,
        message: issue.message,
        nodeId: asNodeId(component.id),
        targetName: component.name,
      });
    }
  }

  // Styles
  for (const style of Object.values(doc.styles ?? {})) {
    const kind = style.type === 'layout' ? 'style' : 'style';
    const result = validateNamingConventions(style.name, kind);
    for (const issue of result.issues) {
      issues.push({
        ruleId: 'naming',
        severity: issue.type as GovernanceSeverity,
        message: issue.message,
        nodeId: style.id,
        targetName: style.name,
      });
    }
  }

  // Variables (in both old and new variable stores)
  const oldVars = Object.values(doc.variableStore?.variables ?? {});
  const collections = Object.values(doc.variableStore?.collections ?? {});
  const collectionVars = collections
    .flatMap((c) => c.variableIds.map((id) => doc.variableStore?.variables[id]))
    .filter((v): v is Variable => v != null);
  const allVars = [...oldVars, ...collectionVars];
  for (const variable of allVars) {
    const result = validateNamingConventions(variable.name, 'variable');
    for (const issue of result.issues) {
      issues.push({
        ruleId: 'naming',
        severity: issue.type as GovernanceSeverity,
        message: issue.message,
        targetName: variable.name,
      });
    }
  }

  return issues;
}

// ── Rule 4: Orphan Rule ────────────────────────────────────────────────────

export function ruleOrphans(doc: Document): GovernanceIssue[] {
  const issues: GovernanceIssue[] = [];

  for (const style of findOrphanedStyles(doc)) {
    issues.push({
      ruleId: 'orphan',
      severity: 'info',
      message: `Style "${style.name}" is not used by any node.`,
      nodeId: style.id,
      targetName: style.name,
    });
  }

  for (const component of findUnusedComponents(doc)) {
    issues.push({
      ruleId: 'orphan',
      severity: 'info',
      message: `Component "${component.name}" is defined but never instantiated.`,
      nodeId: asNodeId(component.id),
      targetName: component.name,
    });
  }

  return issues;
}

// ── Rule 5: Font Rule ──────────────────────────────────────────────────────

function collectFontFamilies(node: SceneNode): string[] {
  if (node.kind !== 'text') return [];
  const families = new Set<string>();
  const primary = node.fontFamily ?? 'Inter';
  families.add(primary);
  if (node.richText) {
    for (const para of node.richText.paragraphs) {
      for (const run of para.runs) {
        if (run.format?.fontFamily) families.add(run.format.fontFamily);
      }
    }
  }
  return [...families];
}

export function ruleFonts(doc: Document, opts: GovernanceRulesOptions): GovernanceIssue[] {
  const issues: GovernanceIssue[] = [];
  const available = opts.availableFonts;
  if (!available || available.size === 0) return issues;

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text') continue;
    const families = collectFontFamilies(node);
    for (const family of families) {
      if (available.has(family)) continue;
      issues.push({
        ruleId: 'font',
        severity: 'error',
        message: `Text node "${node.name}" uses unavailable font "${family}".`,
        nodeId: node.id,
      });
    }
  }

  return issues;
}

// ── Re-exports for consumers that want individual rules ────────────────────

export {
  findOrphanedStyles,
  findUnusedComponents,
  validateComponentProperties,
  validateNamingConventions,
};
