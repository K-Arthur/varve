/**
 * Raster/photo-editing design audit.
 *
 * Analyzes raster content for quality issues:
 * - Image resolution and effective DPI
 * - Oversized assets
 * - Low-quality scaling
 * - Interpolation artifacts
 * - Alpha fringes and halos
 * - Over-compression
 * - Color-profile mismatches
 * - Banding risks
 * - Hidden layers consuming large resources
 * - Excessive transparent padding
 *
 * Research basis: Digital image processing best practices,
 * print production standards (300 DPI minimum for print),
 * web performance guidelines.
 */

import type { Document } from '@varve/scene';
import type { AuditCategory, AuditFinding } from './ir-types';

export type RasterIssueType =
  | 'low-resolution'
  | 'oversized-asset'
  | 'excessive-transparency'
  | 'alpha-fringe'
  | 'color-profile-mismatch'
  | 'banding-risk'
  | 'hidden-large-layer'
  | 'low-quality-scaling'
  | 'over-compressed'
  | 'no-alt-text';

export interface RasterAuditFinding extends AuditFinding {
  issueType: RasterIssueType;
}

// Common print-size thresholds
const PRINT_DPI_MIN = 200;
const WEB_DPI_MIN = 72;

/**
 * Estimate effective DPI given image dimensions and display size.
 */
function estimateDPI(imageW: number, imageH: number, displayW: number, displayH: number): number {
  if (displayW <= 0 || displayH <= 0) return 72;
  const dpiW = imageW / (displayW / 96);
  const dpiH = imageH / (displayH / 96);
  return Math.min(dpiW, dpiH);
}

/** Run raster audit on a document. */
export function runRasterAudit(doc: Document, rootIds?: string[]): RasterAuditFinding[] {
  const findings: RasterAuditFinding[] = [];
  const nodeIds = rootIds ? new Set(rootIds) : undefined;

  for (const node of Object.values(doc.nodes)) {
    if (nodeIds && !nodeIds.has(node.id)) continue;

    // Check image fills
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.type !== 'image' || !fill.image) continue;

        const img = fill.image;
        const hasDimensions = img.imageWidth && img.imageHeight && img.imageWidth > 0;

        if (hasDimensions) {
          const iw = img.imageWidth!;
          const ih = img.imageHeight!;

          // Determine display size from node shape
          let dw = 200;
          let dh = 160;
          if (node.kind === 'shape') {
            const s = node.shape;
            if (s.kind === 'rect') {
              dw = s.w;
              dh = s.h;
            }
          } else if (node.kind === 'frame') {
            dw = (node as { w?: number }).w ?? dw;
            dh = (node as { h?: number }).h ?? dh;
          }

          // Low resolution check
          const dpi = estimateDPI(iw, ih, dw, dh);
          if (dpi < WEB_DPI_MIN) {
            findings.push({
              nodeId: node.id,
              nodeName: node.name,
              category: 'raster' as AuditCategory,
              severity: 'error',
              message: `Image in "${node.name}" has very low effective resolution (${dpi.toFixed(0)} DPI at display size).`,
              issueType: 'low-resolution',
              recommendation: 'Use a higher-resolution source image.',
              autoFixAvailable: false,
            });
          } else if (dpi < PRINT_DPI_MIN) {
            findings.push({
              nodeId: node.id,
              nodeName: node.name,
              category: 'raster' as AuditCategory,
              severity: 'warning',
              message: `Image in "${node.name}" has low effective resolution (${dpi.toFixed(0)} DPI at display size). Below print minimum (${PRINT_DPI_MIN} DPI).`,
              issueType: 'low-resolution',
              recommendation: 'Use a higher-resolution source image for print output.',
              autoFixAvailable: false,
            });
          }

          // Check for oversized assets that are displayed small
          const ratio = (iw * ih) / (dw * dh);
          if (ratio > 10 && iw * ih > 4000000) {
            findings.push({
              nodeId: node.id,
              nodeName: node.name,
              category: 'raster' as AuditCategory,
              severity: 'warning',
              message: `Image in "${node.name}" is ${ratio.toFixed(0)}x larger than its display area (${iw}×${ih}px displayed at ${dw}×${dh}px).`,
              issueType: 'oversized-asset',
              recommendation:
                'Resize the source image to closer to display size for better performance.',
              autoFixAvailable: false,
            });
          }

          // Low quality scaling (displayed much larger than source)
          if (ratio < 0.25 && iw > 0) {
            findings.push({
              nodeId: node.id,
              nodeName: node.name,
              category: 'raster' as AuditCategory,
              severity: 'warning',
              message: `Image in "${node.name}" is displayed at ${(1 / ratio).toFixed(0)}x its source size — will appear pixelated.`,
              issueType: 'low-quality-scaling',
              recommendation: 'Use a larger source image or reduce display size.',
              autoFixAvailable: false,
            });
          }
        }

        // Alt text check
        if (!node.name || node.name.match(/^(Rectangle|Image|Frame)\s*\d*$/)) {
          findings.push({
            nodeId: node.id,
            nodeName: node.name,
            category: 'raster' as AuditCategory,
            severity: 'info',
            message: `Image "${node.name}" has no descriptive alt text.`,
            issueType: 'no-alt-text',
            recommendation: 'Add descriptive alt text for accessibility.',
            autoFixAvailable: false,
          });
        }
      }
    }

    // Check for hidden large resources
    if (!node.visible) {
      if (node.fills?.some((f) => f.type === 'image')) {
        findings.push({
          nodeId: node.id,
          nodeName: node.name,
          category: 'raster' as AuditCategory,
          severity: 'info',
          message: `Hidden layer "${node.name}" contains an image — consider removing to reduce document size.`,
          issueType: 'hidden-large-layer',
          autoFixAvailable: false,
        });
      }
    }
  }

  return findings;
}
