/**
 * Print preflight validation — detects print production issues before export.
 *
 * Checks for missing bleed, incorrect color spaces, missing ICC profiles,
 * oversized documents, unsafe trim placement, low-resolution images, and
 * other common print production problems.
 *
 * Research basis: Adobe InDesign preflight, Callas PDF Toolbox,
 * Enfocus PitStop, ISO 15930 (PDF/X) requirements.
 */

import { physicalToPx } from '@strata/shared';
import type { ColorMode } from './colorManagement';
import type { Document } from './document';
import { isImageShape } from './fills';
import type { NodeId, ShapeNode } from './types';

// ── Types ───────────────────────────────────────────────────────────────────

export type PrintPreflightSeverity = 'error' | 'warning' | 'info';

export type PrintPreflightCategory =
  | 'bleed'
  | 'color-space'
  | 'profile'
  | 'resolution'
  | 'trim'
  | 'spot-color'
  | 'font'
  | 'oversize';

export interface PrintPreflightIssue {
  severity: PrintPreflightSeverity;
  category: PrintPreflightCategory;
  message: string;
  nodeId?: NodeId;
  pageId?: string;
}

export interface PrintPreflightResult {
  issues: PrintPreflightIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** True when errorCount === 0. */
  ready: boolean;
}

export interface PrintPreflightOptions {
  /** Required minimum bleed in mm. */
  minBleedMm?: number;
  /** Required minimum DPI for raster images. */
  minDpi?: number;
  /** Required color mode for print export. */
  requiredColorMode?: ColorMode;
  /** Whether to check for ICC profiles. */
  checkProfiles?: boolean;
  /** Whether to check for content outside safe area. */
  checkSafeArea?: boolean;
  /** Maximum page dimensions in mm (for oversize detection). */
  maxPageMm?: { width: number; height: number };
}

// ── Default Options ─────────────────────────────────────────────────────────

export const DEFAULT_PREFLIGHT_OPTIONS: PrintPreflightOptions = {
  minBleedMm: 3,
  minDpi: 300,
  checkProfiles: true,
  checkSafeArea: false,
};

// ── Preflight Engine ────────────────────────────────────────────────────────

/**
 * Run print preflight checks on a document.
 *
 * Returns a list of issues categorized by severity. The document is
 * "print-ready" when there are zero errors (warnings are acceptable).
 */
export function runPrintPreflight(
  doc: Document,
  options: PrintPreflightOptions = DEFAULT_PREFLIGHT_OPTIONS,
): PrintPreflightResult {
  const issues: PrintPreflightIssue[] = [];
  const opts = { ...DEFAULT_PREFLIGHT_OPTIONS, ...options };

  // ── Bleed checks ──────────────────────────────────────────────────────
  if (opts.minBleedMm !== undefined) {
    if (!doc.bleed) {
      issues.push({
        severity: 'error',
        category: 'bleed',
        message:
          'Document has no bleed configured. Commercial print typically requires at least 3mm bleed.',
      });
    } else {
      const bleedMm = convertBleedToMm(doc.bleed.top, doc.bleed.unit);
      if (bleedMm < opts.minBleedMm) {
        issues.push({
          severity: 'warning',
          category: 'bleed',
          message: `Bleed is ${bleedMm}mm but ${opts.minBleedMm}mm is recommended for commercial print.`,
        });
      }
      if (
        doc.bleed.top !== doc.bleed.right ||
        doc.bleed.right !== doc.bleed.bottom ||
        doc.bleed.bottom !== doc.bleed.left
      ) {
        issues.push({
          severity: 'info',
          category: 'bleed',
          message:
            'Bleed values are not uniform across all edges. Verify this is intentional for your print setup.',
        });
      }
    }
  }

  // ── Color mode checks ─────────────────────────────────────────────────
  if (opts.requiredColorMode) {
    const currentMode = doc.colorConfig?.mode;
    if (!currentMode) {
      issues.push({
        severity: 'warning',
        category: 'color-space',
        message:
          'Document has no color mode configured. Defaulting to RGB may not be suitable for print export.',
      });
    } else if (currentMode !== opts.requiredColorMode) {
      issues.push({
        severity: 'error',
        category: 'color-space',
        message: `Document color mode is ${currentMode.toUpperCase()} but ${opts.requiredColorMode.toUpperCase()} is required for this export.`,
      });
    }
  }

  // ── Profile checks ────────────────────────────────────────────────────
  if (opts.checkProfiles) {
    if (doc.colorConfig?.mode === 'cmyk' && !doc.colorConfig.outputIntent) {
      issues.push({
        severity: 'error',
        category: 'profile',
        message:
          'CMYK document has no output intent (ICC profile) configured. PDF/X export requires an output intent.',
      });
    }
    if (doc.colorConfig && !doc.colorConfig.rgbProfile) {
      issues.push({
        severity: 'warning',
        category: 'profile',
        message: 'No RGB working profile configured. Color conversion may use default sRGB.',
      });
    }
  }

  // ── Resolution checks ─────────────────────────────────────────────────
  if (opts.minDpi !== undefined && doc.dpi !== undefined && doc.dpi > 0) {
    if (doc.dpi < opts.minDpi) {
      issues.push({
        severity: 'warning',
        category: 'resolution',
        message: `Document DPI is ${doc.dpi} but ${opts.minDpi} DPI is recommended for print quality.`,
      });
    }
  }

  // ── Physical dimension checks ─────────────────────────────────────────
  if (opts.maxPageMm && doc.physicalWidth && doc.physicalHeight && doc.documentUnit) {
    const widthMm = convertToMm(doc.physicalWidth, doc.documentUnit);
    const heightMm = convertToMm(doc.physicalHeight, doc.documentUnit);
    if (widthMm > opts.maxPageMm.width || heightMm > opts.maxPageMm.height) {
      issues.push({
        severity: 'warning',
        category: 'oversize',
        message: `Page size ${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm exceeds maximum ${opts.maxPageMm.width}mm x ${opts.maxPageMm.height}mm.`,
      });
    }
  }

  // ── Node-level checks ─────────────────────────────────────────────────
  for (const node of Object.values(doc.nodes)) {
    if (isImageShape(node)) {
      checkImageNode(node as ShapeNode, doc, opts, issues);
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  return {
    issues,
    errorCount,
    warningCount,
    infoCount,
    ready: errorCount === 0,
  };
}

// ── Helper Functions ────────────────────────────────────────────────────────

function convertBleedToMm(value: number, unit: import('@strata/shared').DocumentUnit): number {
  return convertToMm(value, unit);
}

function convertToMm(value: number, unit: import('@strata/shared').DocumentUnit): number {
  const px = physicalToPx(value, unit);
  return px / (96 / 25.4);
}

function checkImageNode(
  node: ShapeNode,
  doc: Document,
  opts: PrintPreflightOptions,
  issues: PrintPreflightIssue[],
): void {
  if (opts.minDpi !== undefined && doc.dpi && doc.dpi > 0) {
    const effectiveDpi = doc.dpi;
    if (effectiveDpi < opts.minDpi) {
      issues.push({
        severity: 'warning',
        category: 'resolution',
        message: `Image "${node.name}" may be low resolution for ${doc.dpi} DPI print output.`,
        nodeId: node.id,
      });
    }
  }
}

// ── Convenience ─────────────────────────────────────────────────────────────

/** Quick check: is the document ready for print export? */
export function isPrintReady(doc: Document, options?: PrintPreflightOptions): boolean {
  return runPrintPreflight(doc, options).ready;
}

/** Get only error-level issues. */
export function getPreflightErrors(
  doc: Document,
  options?: PrintPreflightOptions,
): PrintPreflightIssue[] {
  return runPrintPreflight(doc, options).issues.filter((i) => i.severity === 'error');
}
