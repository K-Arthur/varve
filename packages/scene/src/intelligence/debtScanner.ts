/**
 * Design debt scanner — 15 named pure functions that detect design debt.
 *
 * Each check is a pure function returning DebtIssue[]. Checks include:
 * untokenized colors, inline spacing, naming violations, orphans, missing fonts,
 * duplicate styles, inconsistent border radius, hardcoded font sizes,
 * mixed color spaces, low contrast text, overset text, unnamed layers,
 * excessive nesting, missing export presets.
 */

import type { ColorSwatch, ManagedColor } from '../colorManagement';
import type { Document } from '../document';
import { findOrphanedStyles, findUnusedComponents, validateNamingConventions } from '../governance';
import { addSwatch } from '../swatches';
import type { FrameNode, NodeId, SceneNode, Style, TextNode } from '../types';
import { runIntelligenceAudit } from './audit';

/** Severity of a debt issue. */
export type DebtSeverity = 'error' | 'warning' | 'info';

/** A single debt issue discovered by the scanner. */
export interface DebtIssue {
  /** Check that produced the issue. */
  checkId: string;
  /** Human-readable severity. */
  severity: DebtSeverity;
  /** Human-readable message. */
  message: string;
  /** Affected node id, if applicable. */
  nodeId?: NodeId;
  /** Whether this issue has a one-click fix. */
  fixable: boolean;
  /** One-click fix: returns a new Document with the issue resolved. */
  autoFix?: (doc: Document) => Document;
}

/** Report from the debt scanner with grouped issues and counts. */
export interface DebtReport {
  /** All issues across all checks. */
  issues: DebtIssue[];
  /** Issues grouped by category (checkId). */
  byCategory: Record<string, DebtIssue[]>;
  /** Total error count. */
  totalErrors: number;
  /** Total warning count. */
  totalWarnings: number;
  /** Total info count. */
  totalInfo: number;
}

/** Options for the debt scanner. */
export interface DebtScannerOptions {
  /** Set of available font families (from FontRegistry). */
  availableFonts?: Set<string>;
  /** Base spacing unit in px (default 4). */
  baseSpacingUnit?: number;
  /** Tolerance for spacing "on-grid" checks in px (default 0.5). */
  spacingTolerance?: number;
}

/** Runs all debt checks and returns a combined report. */
export function runDebtScan(doc: Document, opts: DebtScannerOptions = {}): DebtReport {
  const issues: DebtIssue[] = [
    ...checkUntokenizedColors(doc),
    ...checkInlineSpacing(doc, opts),
    ...checkNamingViolations(doc),
    ...checkOrphanedStyles(doc),
    ...checkUnusedComponents(doc),
    ...checkMissingFonts(doc, opts),
    ...checkDuplicateStyles(doc),
    ...checkInconsistentBorderRadius(doc),
    ...checkHardcodedFontSizes(doc),
    ...checkMixedColorSpaces(doc),
    ...checkLowContrastText(doc),
    ...checkOversetText(doc),
    ...checkUnnamedLayers(doc),
    ...checkExcessiveNesting(doc),
    ...checkMissingExportPresets(doc),
  ];

  const byCategory: Record<string, DebtIssue[]> = {};
  for (const issue of issues) {
    const cat = byCategory[issue.checkId] ?? [];
    cat.push(issue);
    byCategory[issue.checkId] = cat;
  }

  return {
    issues,
    byCategory,
    totalErrors: issues.filter((i) => i.severity === 'error').length,
    totalWarnings: issues.filter((i) => i.severity === 'warning').length,
    totalInfo: issues.filter((i) => i.severity === 'info').length,
  };
}

// ── Check 1: Untokenized Colors ───────────────────────────────────────────

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
  const tolerance = 1.5;
  return swatches.find((s) => colorsEqual(s.color, color, tolerance));
}

function extractNodeFills(node: SceneNode): ManagedColor[] {
  if (node.paintRefs && node.paintRefs.length > 0) return [];
  if (node.fills && node.fills.length > 0) {
    return node.fills
      .filter((f) => f.visible !== false && f.type === 'solid' && f.color)
      .map((f) => f.color!);
  }
  return [node.fill];
}

export function checkUntokenizedColors(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];
  const swatches = doc.swatches ?? [];
  if (swatches.length === 0) return issues;

  for (const node of Object.values(doc.nodes)) {
    const colors = extractNodeFills(node);
    for (const color of colors) {
      if (color.a === 0) continue;
      const match = findMatchingSwatch(color, swatches);
      if (match) continue;
      issues.push({
        checkId: 'untokenized-colors',
        severity: 'warning',
        message: `"${node.name}" uses a color not in document swatches.`,
        nodeId: node.id,
        fixable: true,
        autoFix: (doc: Document) => addSwatch(doc, `${node.name} color`, color),
      });
    }
  }
  return issues;
}

// ── Check 2: Inline Spacing ───────────────────────────────────────────────

function isOnGrid(value: number, base: number, tolerance: number): boolean {
  if (value === 0) return true;
  const ratio = value / base;
  return Math.abs(ratio - Math.round(ratio)) <= tolerance / base;
}

function checkFrameSpacing(
  node: FrameNode,
  base: number,
  tolerance: number,
): DebtIssue | undefined {
  const ls = node.layoutStyle;
  if (!ls) return undefined;

  const problems: string[] = [];
  if (!isOnGrid(ls.gap, base, tolerance)) problems.push(`gap ${ls.gap}px`);
  const [pt, pr, pb, pl] = ls.padding;
  if (!isOnGrid(pt, base, tolerance)) problems.push(`padding-top ${pt}px`);
  if (!isOnGrid(pr, base, tolerance)) problems.push(`padding-right ${pr}px`);
  if (!isOnGrid(pb, base, tolerance)) problems.push(`padding-bottom ${pb}px`);
  if (!isOnGrid(pl, base, tolerance)) problems.push(`padding-left ${pl}px`);

  if (problems.length === 0) return undefined;

  return {
    checkId: 'inline-spacing',
    severity: 'warning',
    message: `Frame "${node.name}" has non-grid spacing: ${problems.join(', ')} (base ${base}px).`,
    nodeId: node.id,
    fixable: false,
  };
}

export function checkInlineSpacing(doc: Document, opts: DebtScannerOptions = {}): DebtIssue[] {
  const issues: DebtIssue[] = [];
  const base = opts.baseSpacingUnit ?? 4;
  const tolerance = opts.spacingTolerance ?? 0.5;

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'frame') continue;
    const issue = checkFrameSpacing(node, base, tolerance);
    if (issue) issues.push(issue);
  }
  return issues;
}

// ── Check 3: Naming Violations ─────────────────────────────────────────────

function asNodeId(id: string): NodeId {
  return id;
}

export function checkNamingViolations(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];

  for (const component of Object.values(doc.components)) {
    const result = validateNamingConventions(component.name, 'component');
    for (const issue of result.issues) {
      issues.push({
        checkId: 'naming-violations',
        severity: issue.type as DebtSeverity,
        message: issue.message,
        nodeId: asNodeId(component.id),
        fixable: false,
      });
    }
  }

  for (const style of Object.values(doc.styles ?? {})) {
    const kind = style.type === 'layout' ? 'style' : 'style';
    const result = validateNamingConventions(style.name, kind);
    for (const issue of result.issues) {
      issues.push({
        checkId: 'naming-violations',
        severity: issue.type as DebtSeverity,
        message: issue.message,
        nodeId: style.id,
        fixable: false,
      });
    }
  }

  return issues;
}

// ── Check 4: Orphaned Styles ────────────────────────────────────────────────

export function checkOrphanedStyles(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];

  for (const style of findOrphanedStyles(doc)) {
    issues.push({
      checkId: 'orphan-styles',
      severity: 'info',
      message: `Style "${style.name}" is not used by any node.`,
      nodeId: style.id,
      fixable: false,
    });
  }

  return issues;
}

// ── Check 5: Unused Components ───────────────────────────────────────────

export function checkUnusedComponents(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];

  for (const component of findUnusedComponents(doc)) {
    issues.push({
      checkId: 'unused-components',
      severity: 'info',
      message: `Component "${component.name}" is defined but never instantiated.`,
      nodeId: asNodeId(component.id),
      fixable: false,
    });
  }

  return issues;
}

// ── Check 6: Missing Fonts ───────────────────────────────────────────────

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

/** Replaces every occurrence of `from` with `to` in a text node's fontFamily
 *  and any rich-text run format, leaving other families untouched. */
function replaceFontFamilyInNode(node: TextNode, from: string, to: string): TextNode {
  let updated = node;
  if (updated.fontFamily === from) {
    updated = { ...updated, fontFamily: to };
  }
  if (updated.richText) {
    updated = {
      ...updated,
      richText: {
        ...updated.richText,
        paragraphs: updated.richText.paragraphs.map((para) => ({
          ...para,
          runs: para.runs.map((run) =>
            run.format?.fontFamily === from
              ? { ...run, format: { ...run.format, fontFamily: to } }
              : run,
          ),
        })),
      },
    };
  }
  return updated;
}

export function checkMissingFonts(doc: Document, opts: DebtScannerOptions = {}): DebtIssue[] {
  const issues: DebtIssue[] = [];
  const available = opts.availableFonts;
  if (!available || available.size === 0) return issues;
  const fallback = [...available][0]!;

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text') continue;
    const families = collectFontFamilies(node);
    for (const family of families) {
      if (available.has(family)) continue;
      issues.push({
        checkId: 'missing-fonts',
        severity: 'error',
        message: `Text node "${node.name}" uses unavailable font "${family}".`,
        nodeId: node.id,
        fixable: true,
        autoFix: (d: Document) => {
          const target = d.nodes[node.id];
          if (target?.kind !== 'text') return d;
          return {
            ...d,
            nodes: { ...d.nodes, [node.id]: replaceFontFamilyInNode(target, family, fallback) },
          };
        },
      });
    }
  }

  return issues;
}

// ── Check 7: Duplicate Styles ───────────────────────────────────────────

function stableSerialize(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(',')}}`;
}

function stylePayload(style: Style): string {
  const { id: _id, name: _name, ...payload } = style;
  return stableSerialize(payload);
}

export function checkDuplicateStyles(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];
  const styles = Object.values(doc.styles ?? {});
  if (styles.length < 2) return issues;

  for (let i = 0; i < styles.length; i++) {
    for (let j = i + 1; j < styles.length; j++) {
      const a = styles[i];
      const b = styles[j];
      if (!a || !b) continue;
      if (a.type !== b.type) continue;
      if (a.name === b.name) continue;

      if (stylePayload(a) === stylePayload(b)) {
        issues.push({
          checkId: 'duplicate-styles',
          severity: 'warning',
          message: `Styles "${a.name}" and "${b.name}" have identical properties.`,
          nodeId: a.id,
          fixable: false,
        });
      }
    }
  }

  return issues;
}

// ── Check 8: Inconsistent Border Radius ─────────────────────────────────

export function checkInconsistentBorderRadius(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];
  const radii = new Map<number, NodeId[]>();

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'shape') continue;
    const shape = node.shape;
    if (shape.kind !== 'rect') continue;
    if ('cornerRadius' in shape && shape.cornerRadius === undefined) continue;
    if (!('cornerRadius' in shape)) continue;

    const cr = shape.cornerRadius as number | [number, number, number, number] | undefined;
    const r = typeof cr === 'number' ? cr : (cr?.[0] ?? 0);
    const nodes = radii.get(r) ?? [];
    nodes.push(node.id);
    radii.set(r, nodes);
  }

  if (radii.size <= 2) return issues; // 1 or 2 distinct values is fine
  const values = [...radii.keys()].sort((a, b) => a - b);
  issues.push({
    checkId: 'inconsistent-radius',
    severity: 'info',
    message: `Document uses ${radii.size} different border radius values (${values.join(', ')}px). Consider standardizing.`,
    fixable: false,
  });

  return issues;
}

// ── Check 9: Hardcoded Font Sizes ─────────────────────────────────────────

const TYPE_SCALE = [12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80];

export function checkHardcodedFontSizes(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text') continue;
    const size = node.fontSize ?? 16;
    if (!TYPE_SCALE.includes(size)) {
      issues.push({
        checkId: 'hardcoded-font-sizes',
        severity: 'info',
        message: `Text node "${node.name}" uses font size ${size}px, not on type scale.`,
        nodeId: node.id,
        fixable: false,
      });
    }
  }

  return issues;
}

// ── Check 10: Mixed Color Spaces ─────────────────────────────────────────

export function checkMixedColorSpaces(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];
  const docColorMode = doc.colorConfig?.mode;

  if (!docColorMode) return issues;
  if (docColorMode === 'rgb') return issues;

  // For CMYK or grayscale docs, flag RGB fills
  for (const node of Object.values(doc.nodes)) {
    const fills = extractNodeFills(node);
    for (const fill of fills) {
      if (fill.a === 0) continue;
      if (fill.space === 'rgb') {
        issues.push({
          checkId: 'mixed-color-spaces',
          severity: 'warning',
          message: `Node "${node.name}" uses RGB color space in a ${docColorMode} document.`,
          nodeId: node.id,
          fixable: false,
        });
      }
    }
  }

  return issues;
}

// ── Check 11: Low Contrast Text ─────────────────────────────────────────

export function checkLowContrastText(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];
  const auditIssues = runIntelligenceAudit(doc);

  for (const issue of auditIssues) {
    if (issue.type === 'contrast-aa-fail') {
      issues.push({
        checkId: 'low-contrast',
        severity: issue.severity as DebtSeverity,
        message: issue.message,
        nodeId: issue.nodeId,
        fixable: issue.autoFix !== undefined,
      });
    }
  }

  return issues;
}

// ── Check 12: Overset Text ─────────────────────────────────────────────

export function checkOversetText(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text') continue;
    if (node.textOverflow === 'visible') continue;
    if (node.textOverflow === 'ellipsis' || node.textOverflow === 'clip') {
      issues.push({
        checkId: 'overset-text',
        severity: 'warning',
        message: `Text node "${node.name}" may have overset content (overflow is ${node.textOverflow}).`,
        nodeId: node.id,
        fixable: false,
      });
    }
  }

  return issues;
}

// ── Check 13: Unnamed Layers ─────────────────────────────────────────────

const DEFAULT_NAME_PATTERNS = [
  /^Rectangle \d+$/,
  /^Ellipse \d+$/,
  /^Frame \d+$/,
  /^Group \d+$/,
  /^Text \d+$/,
];

export function checkUnnamedLayers(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];

  for (const node of Object.values(doc.nodes)) {
    if (DEFAULT_NAME_PATTERNS.some((p) => p.test(node.name))) {
      issues.push({
        checkId: 'unnamed-layers',
        severity: 'info',
        message: `Node "${node.name}" has a default name. Consider renaming.`,
        nodeId: node.id,
        fixable: false,
      });
    }
  }

  return issues;
}

// ── Check 14: Excessive Nesting ─────────────────────────────────────────

function getNodeDepth(doc: Document, nodeId: NodeId): number {
  const node = doc.nodes[nodeId];
  if (!node) return 0;
  if (!('children' in node) || !node.children) return 0;

  let maxChildDepth = 0;
  for (const childId of node.children) {
    maxChildDepth = Math.max(maxChildDepth, getNodeDepth(doc, childId));
  }
  return maxChildDepth + 1;
}

export function checkExcessiveNesting(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];
  const MAX_DEPTH = 5;

  for (const nodeId of doc.rootChildren) {
    const depth = getNodeDepth(doc, nodeId);
    if (depth > MAX_DEPTH) {
      issues.push({
        checkId: 'excessive-nesting',
        severity: 'warning',
        message: `Node tree has depth ${depth} (max recommended: ${MAX_DEPTH}).`,
        nodeId,
        fixable: false,
      });
    }
  }

  return issues;
}

// ── Check 15: Missing Export Presets ─────────────────────────────────────

export function checkMissingExportPresets(doc: Document): DebtIssue[] {
  const issues: DebtIssue[] = [];
  const rootNodes = doc.rootChildren;

  for (const nodeId of rootNodes) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    if (!node.presets || node.presets.length === 0) {
      issues.push({
        checkId: 'missing-export-presets',
        severity: 'info',
        message: `Root node "${node.name}" has no export presets.`,
        nodeId,
        fixable: false,
      });
    }
  }

  return issues;
}
