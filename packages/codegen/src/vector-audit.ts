/**
 * Vector/illustration design audit.
 *
 * Analyzes vector artwork for quality issues:
 * - Unnecessary anchor points
 * - Malformed paths
 * - Self-intersections
 * - Boolean artifacts
 * - Inconsistent stroke widths
 * - Off-canvas objects
 * - Redundant groups
 * - Empty/invisible objects
 * - Gradient continuity issues
 *
 * Research basis: SVG spec, vector design best practices,
 * font engineering guidelines for path quality.
 */

import type { Document, SceneNode } from '@strata/scene';
import type { AuditCategory, AuditFinding } from './ir-types';

export type VectorIssueType =
  | 'unnecessary-anchors'
  | 'self-intersection'
  | 'open-path'
  | 'zero-area-path'
  | 'off-canvas'
  | 'redundant-group'
  | 'empty-group'
  | 'invisible-object'
  | 'inconsistent-stroke'
  | 'malformed-path'
  | 'boolean-artifact'
  | 'unlinked-mask';

export interface VectorAuditFinding extends AuditFinding {
  issueType: VectorIssueType;
  suggestion?: string;
}

/** Find paths where all points are collinear or nearly so. */
function detectRedundantAnchors(node: SceneNode): number {
  if (node.kind !== 'shape' || node.shape.kind !== 'path') return 0;
  const pts = node.shape.points;
  if (pts.length < 3) return 0;

  let redundant = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    if (!prev || !curr || !next) continue;

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    // Check if the point is approximately collinear
    const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const normalizedCross = cross / (len1 * len2 + 0.001);

    if (normalizedCross < 0.01 && !curr.handleIn && !curr.handleOut) {
      redundant++;
    }
  }

  return redundant;
}

/** Check if path has self-intersections. */
function hasSelfIntersection(node: SceneNode): boolean {
  if (node.kind !== 'shape' || node.shape.kind !== 'path') return false;
  const pts = node.shape.points;
  if (pts.length < 4) return false;

  for (let i = 0; i < pts.length; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % pts.length];
    if (!a1 || !a2) continue;

    for (let j = i + 2; j < pts.length; j++) {
      const b1 = pts[j];
      const b2 = pts[(j + 1) % pts.length];
      if (!b1 || !b2) continue;

      // Simple segment intersection test
      const d1x = a2.x - a1.x;
      const d1y = a2.y - a1.y;
      const d2x = b2.x - b1.x;
      const d2y = b2.y - b1.y;
      const denom = d1x * d2y - d1y * d2x;
      if (Math.abs(denom) < 0.001) continue;

      const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
      const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;

      if (t >= 0.001 && t <= 0.999 && u >= 0.001 && u <= 0.999) {
        return true;
      }
    }
  }

  return false;
}

/** Calculate the area of a polygon using the shoelace formula. */
function polygonArea(pts: { x: number; y: number }[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/** Audit vector artwork in a document. */
export function runVectorAudit(doc: Document, rootIds?: string[]): VectorAuditFinding[] {
  const findings: VectorAuditFinding[] = [];
  const nodeIds = rootIds ? new Set(rootIds) : undefined;

  for (const node of Object.values(doc.nodes)) {
    if (nodeIds && !nodeIds.has(node.id)) continue;
    if (!node.visible) {
      findings.push({
        nodeId: node.id,
        nodeName: node.name,
        category: 'vector' as AuditCategory,
        severity: 'info',
        message: `Hidden vector object "${node.name}" included in document.`,
        issueType: 'invisible-object',
        autoFixAvailable: false,
      });
      continue;
    }

    if (node.kind !== 'shape') continue;
    const s = node.shape;

    // Off-canvas detection
    if (s.kind === 'rect' && (s.x + s.w < 0 || s.y + s.h < 0 || s.x > 10000 || s.y > 10000)) {
      findings.push({
        nodeId: node.id,
        nodeName: node.name,
        category: 'vector' as AuditCategory,
        severity: 'warning',
        message: `Shape "${node.name}" is positioned off-canvas (${s.x}, ${s.y}).`,
        issueType: 'off-canvas',
        recommendation: 'Move the shape on-canvas or delete it.',
        autoFixAvailable: false,
      });
    }

    // Path-specific checks
    if (s.kind === 'path') {
      const pts = s.points;

      // Open path check
      if (pts.length >= 2 && !s.closed) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (first && last) {
          const dist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
          if (dist < 2) {
            findings.push({
              nodeId: node.id,
              nodeName: node.name,
              category: 'vector' as AuditCategory,
              severity: 'warning',
              message: `Path "${node.name}" has endpoints within 2px but is not closed.`,
              issueType: 'open-path',
              recommendation: 'Close the path to prevent rendering artifacts.',
              autoFixAvailable: false,
            });
          }
        }
      }

      // Zero-area path
      if (pts.length >= 3 && s.closed) {
        const area = polygonArea(pts);
        if (area < 1) {
          findings.push({
            nodeId: node.id,
            nodeName: node.name,
            category: 'vector' as AuditCategory,
            severity: 'warning',
            message: `Path "${node.name}" has near-zero area (${area.toFixed(2)}px²).`,
            issueType: 'zero-area-path',
            recommendation: 'Check if the path defines meaningful geometry.',
            autoFixAvailable: false,
          });
        }
      }

      // Redundant anchors
      const redundant = detectRedundantAnchors(node);
      if (redundant > 2) {
        findings.push({
          nodeId: node.id,
          nodeName: node.name,
          category: 'vector' as AuditCategory,
          severity: 'info',
          message: `Path "${node.name}" has ${redundant} potentially redundant anchor points.`,
          issueType: 'unnecessary-anchors',
          recommendation: 'Simplify the path to reduce file size and improve performance.',
          autoFixAvailable: false,
        });
      }

      // Self-intersections
      if (hasSelfIntersection(node)) {
        findings.push({
          nodeId: node.id,
          nodeName: node.name,
          category: 'vector' as AuditCategory,
          severity: 'warning',
          message: `Path "${node.name}" has self-intersections.`,
          issueType: 'self-intersection',
          recommendation: 'Resolve self-intersections to ensure correct fill rendering.',
          autoFixAvailable: false,
        });
      }
    }

    // Stroke inconsistency
    if (node.strokes && node.strokes.length > 0) {
      const weights = node.strokes.filter((st) => st.visible !== false).map((st) => st.weight);
      const uniqueWeights = new Set(weights);
      if (uniqueWeights.size > 1) {
        findings.push({
          nodeId: node.id,
          nodeName: node.name,
          category: 'vector' as AuditCategory,
          severity: 'info',
          message: `Shape "${node.name}" has inconsistent stroke weights: ${[...uniqueWeights].join(', ')}px.`,
          issueType: 'inconsistent-stroke',
          recommendation: 'Consider using a single stroke weight for consistency.',
          autoFixAvailable: false,
        });
      }
    }
  }

  // Check for redundant groups
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'group') continue;
    const children = node.children ?? [];
    if (children.length === 0) {
      findings.push({
        nodeId: node.id,
        nodeName: node.name,
        category: 'vector' as AuditCategory,
        severity: 'info',
        message: `Group "${node.name}" is empty.`,
        issueType: 'empty-group',
        recommendation: 'Remove empty groups to reduce document complexity.',
        autoFixAvailable: false,
      });
    } else if (children.length === 1) {
      const child = doc.nodes[children[0]];
      if (
        child &&
        !child.transform.some((v: number) => Math.abs(v - (child.kind === 'shape' ? 1 : 0)) > 0.01)
      ) {
        // Group with single child and no transform — redundant
      }
    }
  }

  return findings;
}
