/**
 * Intelligence panel — audit issue types and the WCAG contrast audit runner.
 *
 * The contrast math and auto-fix algorithm live in @strata/shared
 * (contrast.ts); this module walks the document to find text/background
 * pairs and turns low-contrast pairs into AuditIssues the panel can render.
 *
 * Research basis: WCAG 2.1 §1.4.3, §1.4.6, §1.4.11 (Non-text Contrast).
 */

import {
  autoFixContrast,
  contrastRatio,
  relativeLuminance,
  WCAG_AA_LARGE,
  WCAG_AA_NORMAL,
} from '@strata/shared';
import type { Document } from '../document';
import { getParent } from '../document';
import type { NodeId, SceneNode } from '../types';

/** Severity level for an audit issue. */
export type AuditSeverity = 'error' | 'warning' | 'info';

/** A single audit issue discovered during a design review pass. */
export interface AuditIssue {
  /** The ID of the affected node. */
  nodeId: string;

  /** Machine-readable issue type (e.g. 'contrast-aa-fail'). */
  type: string;

  /** Human-readable severity classification. */
  severity: AuditSeverity;

  /** Human-readable description of the issue. */
  message: string;

  /**
   * Optional auto-fix function that returns a new Document with the
   * issue resolved. Undefined if no automated fix is available.
   */
  autoFix?: () => Document;
}

interface RgbTuple {
  r: number;
  g: number;
  b: number;
}

/** Extracts an opaque RGB triple from a node's solid fill, or null. */
function resolveRgbFill(node: SceneNode): RgbTuple | null {
  const solidFromFills = node.fills?.find((f) => f.type === 'solid' && f.visible !== false)?.color;
  const color = solidFromFills ?? ('fill' in node ? node.fill : undefined);
  if (!color || color.space !== 'rgb') return null;
  return { r: color.r, g: color.g, b: color.b };
}

/** Walks up from a node to find the nearest ancestor with a resolvable solid background. */
function resolveBackground(doc: Document, nodeId: NodeId): RgbTuple | null {
  let currentId = getParent(doc, nodeId);
  while (currentId) {
    const node = doc.nodes[currentId];
    if (!node) return null;
    const rgb = resolveRgbFill(node);
    if (rgb) return rgb;
    currentId = getParent(doc, currentId);
  }
  return null;
}

/** True when the given font size/weight qualifies for WCAG's "large text" thresholds. */
function isLargeText(fontSize: number, fontWeight?: number): boolean {
  const pt = fontSize * 0.75; // px -> pt at 96dpi, matching WCAG's point-size thresholds
  return pt >= 18 || (pt >= 14 && (fontWeight ?? 400) >= 700);
}

/**
 * Runs a WCAG text-contrast audit over the document: for every text node
 * with a solid RGB fill, finds the nearest ancestor with a resolvable solid
 * RGB background and checks contrast against it.
 *
 * Scope: solid `fill`/`fills` colors only — richText per-run colors, CMYK/
 * spot colors, gradients, images, and paintRefs-based paints are not
 * resolved here and are silently skipped (no false positives, but also no
 * coverage) rather than guessed at.
 */
export function runIntelligenceAudit(doc: Document): AuditIssue[] {
  const issues: AuditIssue[] = [];

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text' || !node.visible) continue;
    const fg = resolveRgbFill(node);
    if (!fg) continue;
    const bg = resolveBackground(doc, node.id);
    if (!bg) continue;

    const ratio = contrastRatio(
      relativeLuminance(fg.r, fg.g, fg.b),
      relativeLuminance(bg.r, bg.g, bg.b),
    );
    const large = isLargeText(node.fontSize, node.fontWeight);
    const minRatio = large ? WCAG_AA_LARGE : WCAG_AA_NORMAL;
    if (ratio >= minRatio) continue;

    const nodeId = node.id;
    issues.push({
      nodeId,
      type: 'contrast-aa-fail',
      severity: ratio < minRatio * 0.7 ? 'error' : 'warning',
      message: `"${node.name}" has ${ratio.toFixed(2)}:1 contrast against its background, below the WCAG AA minimum of ${minRatio}:1 for ${large ? 'large' : 'normal'} text.`,
      autoFix: () => {
        const fixed = autoFixContrast(fg.r, fg.g, fg.b, bg.r, bg.g, bg.b, minRatio);
        if (!fixed) return doc;
        const current = doc.nodes[nodeId];
        if (!current || current.kind !== 'text' || current.fill.space !== 'rgb') return doc;
        return {
          ...doc,
          nodes: {
            ...doc.nodes,
            [nodeId]: {
              ...current,
              fill: { ...current.fill, r: fixed.r, g: fixed.g, b: fixed.b },
            },
          },
        };
      },
    });
  }

  return issues;
}
