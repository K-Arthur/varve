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

import { DEFAULT_ARTWORK_FONT_FAMILY, physicalToPx } from '@varve/shared';
import type { ColorMode } from './colorManagement';
import type { Document } from './document';
import { effectiveRasterPpiForNode } from './export/resolution';
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
  /** Whether to check raster images for colour profiles (IMAGE_PROFILE_MISSING). */
  checkImageProfiles?: boolean;
  /** Whether to check for content outside safe area. */
  checkSafeArea?: boolean;
  /** Maximum page dimensions in mm (for oversize detection). */
  maxPageMm?: { width: number; height: number };
  /** Whether to check for font availability and text overflow. */
  checkFonts?: boolean;
  /** Set of available font families (used for font checks). */
  availableFonts?: Set<string>;
  /** Maximum Total Area Coverage percentage for CMYK documents (default 300). */
  maxTacPercent?: number;
}

// ── Default Options ─────────────────────────────────────────────────────────

export const DEFAULT_PREFLIGHT_OPTIONS: PrintPreflightOptions = {
  minBleedMm: 3,
  minDpi: 300,
  checkProfiles: true,
  checkImageProfiles: true,
  checkSafeArea: false,
  maxTacPercent: 300,
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
      checkImageNode(doc, node as ShapeNode, opts, issues);
      if (opts.checkImageProfiles) {
        checkImageProfile(node as ShapeNode, doc, opts, issues);
      }
    }
    if (node.kind === 'shape') {
      checkNodeColorSpace(node, opts, issues);
    }
    if (opts.checkFonts && node.kind === 'text') {
      checkTextNodeForPrint(node, opts, issues);
    }
  }

  // ── TAC check ─────────────────────────────────────────────────────────
  const maxTac = opts.maxTacPercent ?? 300;
  if (doc.colorConfig?.mode === 'cmyk' && maxTac > 0) {
    for (const node of Object.values(doc.nodes)) {
      const tac = estimateTac(node);
      if (tac !== null && tac > maxTac) {
        issues.push({
          severity: 'warning',
          category: 'color-space',
          message: `Node "${node.name}" has estimated TAC of ${tac}%, exceeding the recommended ${maxTac}% limit.`,
          nodeId: node.id,
        });
      }
    }
  }

  // ── Text chain/story checks (v2.18 stories authoritative) ─────────────
  const textChains = doc.textChains as Record<string, import('./typography').TextChain> | undefined;
  const chainFrameIds: NodeId[] = [];
  if (textChains) {
    for (const entry of Object.entries(textChains)) {
      const chain = entry[1];
      if (chain) chainFrameIds.push(...chain.frameIds);
    }
  }
  for (const story of Object.values(doc.stories ?? {})) {
    if (story) chainFrameIds.push(...story.thread);
  }
  if (opts.checkFonts) {
    for (const frameId of chainFrameIds) {
      if (!doc.nodes[frameId]) {
        issues.push({
          severity: 'error',
          category: 'font',
          message: `Text chain/story references missing frame ${frameId}`,
          nodeId: frameId,
        });
      }
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

/**
 * Estimate Total Area Coverage (TAC) for a node by summing C+M+Y+K values
 * of solid fills. Returns null for non-CMYK fills or non-solid types.
 */
function estimateTac(node: import('./types').SceneNode): number | null {
  if (node.fill?.space !== 'cmyk') {
    const fills = 'fills' in node ? (node as import('./types').ShapeNode).fills : undefined;
    if (fills) {
      const cmyk = fills.find(
        (f) => f.type === 'solid' && f.visible !== false && f.color?.space === 'cmyk',
      );
      if (cmyk?.color && cmyk.color.space === 'cmyk') {
        return cmyk.color.c + cmyk.color.m + cmyk.color.y + cmyk.color.k;
      }
    }
    return null;
  }
  return node.fill.c + node.fill.m + node.fill.y + node.fill.k;
}

// ── Helper Functions ────────────────────────────────────────────────────────

function convertBleedToMm(value: number, unit: import('@varve/shared').DocumentUnit): number {
  return convertToMm(value, unit);
}

function convertToMm(value: number, unit: import('@varve/shared').DocumentUnit): number {
  const px = physicalToPx(value, unit);
  return px / (96 / 25.4);
}

function checkTextNodeForPrint(
  node: import('./types').TextNode,
  opts: { availableFonts?: Set<string> },
  issues: PrintPreflightIssue[],
): void {
  const fontFamily = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
  if (opts.availableFonts && opts.availableFonts.size > 0 && !opts.availableFonts.has(fontFamily)) {
    issues.push({
      severity: 'error',
      category: 'font',
      message: `Font "${fontFamily}" is not available. Text may render incorrectly in print output.`,
      nodeId: node.id,
    });
  }
  // Check rich text run fonts
  if (node.richText) {
    for (const para of node.richText.paragraphs) {
      for (const run of para.runs) {
        const runFont = run.format?.fontFamily;
        if (
          runFont &&
          opts.availableFonts &&
          opts.availableFonts.size > 0 &&
          !opts.availableFonts.has(runFont)
        ) {
          issues.push({
            severity: 'error',
            category: 'font',
            message: `Font "${runFont}" used in rich text run is not available.`,
            nodeId: node.id,
          });
        }
      }
    }
  }
}

/**
 * Computes the effective PPI of a placed image using the same canonical fill
 * and world-transform math used by export preflight. This is independent of
 * the document's target export DPI (`doc.dpi`, checked separately above).
 */
function checkImageNode(
  doc: Document,
  node: ShapeNode,
  opts: PrintPreflightOptions,
  issues: PrintPreflightIssue[],
): void {
  if (opts.minDpi === undefined) return;
  const effective = effectiveRasterPpiForNode(doc, node);
  if (effective?.available && effective.minimumPpi < opts.minDpi) {
    issues.push({
      severity: 'warning',
      category: 'resolution',
      message: `Image "${node.name}" is placed at approximately ${Math.round(effective.minimumPpi)} effective PPI, below the recommended ${opts.minDpi} PPI for print quality.`,
      nodeId: node.id,
    });
  }
}

/**
 * IMAGE_PROFILE_MISSING / IMAGE_PROFILE_INVALID / IMAGE_PROFILE_MISMATCH
 * findings for placed raster images.
 *
 * The colour interpretation of a raster comes from `asset.metadata`
 * (`colorEncoding` provenance / `iccStatus`), recorded at ingestion:
 *  - no colour metadata at all (legacy or untagged) → warning, the image
 *    will be interpreted as sRGB and preflight says so explicitly;
 *  - extraction reported an invalid embedded profile → warning;
 *  - an embedded profile exists and differs from the document RGB working
 *    profile → info, conversion is pending at render/export.
 */
function checkImageProfile(
  node: ShapeNode,
  doc: Document,
  _opts: PrintPreflightOptions,
  issues: PrintPreflightIssue[],
): void {
  const fill = node.fills?.find((f) => f.type === 'image');
  const img = fill?.image;
  if (!img?.assetId) return;
  const asset = doc.assets?.[img.assetId];
  if (!asset) return;
  const metadata = asset.metadata;

  if (metadata?.iccStatus === 'invalid') {
    issues.push({
      severity: 'warning',
      category: 'profile',
      message: `Image "${node.name}" has an invalid embedded colour profile; its pixels cannot be colour-managed accurately.`,
      nodeId: node.id,
    });
    return;
  }

  const encoding = metadata?.colorEncoding;
  const provenance = encoding?.provenance;
  const untagged =
    provenance === undefined ||
    provenance === 'format-default' ||
    provenance === 'assumed' ||
    provenance === 'legacy-assumed-srgb';
  if (untagged) {
    issues.push({
      severity: 'warning',
      category: 'profile',
      message: `Image "${node.name}" has no embedded colour profile; it will be interpreted as sRGB (${provenance === 'legacy-assumed-srgb' ? 'legacy assumption' : 'untagged source'}).`,
      nodeId: node.id,
    });
    return;
  }

  if (provenance === 'embedded-icc' || provenance === 'cicp' || provenance === 'named') {
    const documentProfile = doc.colorConfig?.rgbProfile?.id;
    const sourceLabel = encoding?.primaries ?? 'unknown';
    const mismatched =
      documentProfile !== undefined &&
      sourceLabel !== 'unknown' &&
      !primariesMatchProfile(sourceLabel, documentProfile);
    if (mismatched) {
      issues.push({
        severity: 'info',
        category: 'profile',
        message: `Image "${node.name}" embeds a ${sourceLabel} colour profile but the document works in ${documentProfile}; pixels are converted at render time.`,
        nodeId: node.id,
      });
    }
  }
}

/** Approximate primaries<->profile-id match used by the mismatch finding. */
function primariesMatchProfile(primaries: string, profileId: string): boolean {
  switch (primaries) {
    case 'srgb':
      return profileId === 'srgb';
    case 'display-p3':
      return profileId === 'display-p3';
    case 'adobe-rgb':
      return profileId === 'adobe-rgb';
    case 'pro-photo':
      return profileId === 'pro-photo';
    case 'rec2020':
      return profileId === 'rec2020';
    default:
      return true; // unknown primaries: no claim of mismatch
  }
}

/**
 * Flags shapes with an RGB fill or stroke color when the export target
 * requires CMYK. Only solid colors are checked (gradients/patterns resolve
 * per-stop and are out of scope for this pass).
 */ function checkNodeColorSpace(
  node: ShapeNode,
  opts: PrintPreflightOptions,
  issues: PrintPreflightIssue[],
): void {
  if (opts.requiredColorMode !== 'cmyk') return;

  const hasRgbFill = node.fills?.some(
    (f) => f.type === 'solid' && f.visible !== false && f.color?.space === 'rgb',
  );
  if (hasRgbFill) {
    issues.push({
      severity: 'warning',
      category: 'color-space',
      message: `"${node.name}" uses an RGB fill color; convert to CMYK for accurate print output.`,
      nodeId: node.id,
    });
  }

  const hasRgbStroke = node.strokes?.some((s) => s.visible && s.color?.space === 'rgb');
  if (hasRgbStroke) {
    issues.push({
      severity: 'warning',
      category: 'color-space',
      message: `"${node.name}" uses an RGB stroke color; convert to CMYK for accurate print output.`,
      nodeId: node.id,
    });
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
