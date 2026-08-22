/**
 * Export preflight service (Strata export rebuild, M4).
 *
 * A shared findings pipeline feeding both the export plan and the UI — no
 * scattered inline warnings. Findings are deterministic for tests, link to the
 * affected configurations/nodes, distinguish blocking errors from advisory
 * warnings, and may carry a safe {@link ExportFixAction}.
 *
 * Preflight never mutates the document.
 */

import type { Document } from '../document';
import { walkNodes } from '../document';
import type { NodeId } from '../types';
import {
  capabilitiesForFormat,
  type FormatCapability,
  formatSupportedOnPlatform,
  type PlatformKind,
} from './capabilities';
import type { ExportBatchRequest, ExportFormat, ExportJobSpec } from './model';
import { buildExportPlan, type ExportPlan } from './plan';
import { effectiveRasterPpiForNode } from './resolution';

// ── Findings ────────────────────────────────────────────────────────────────

export type ExportFindingSeverity = 'info' | 'warning' | 'error';

export type ExportFixAction =
  | { type: 'none' }
  | { type: 'flatten-raster'; nodeIds: NodeId[] }
  | { type: 'outline-text'; nodeIds: NodeId[] }
  | { type: 'convert-color-space'; target: 'srgb' | 'cmyk' | 'grayscale' }
  | { type: 'set-background'; color: [number, number, number, number] };

export interface ExportFinding {
  /** Deterministic id: `${code}:${configurationId}:${nodeIds.join(',')}`. */
  id: string;
  code: string;
  severity: ExportFindingSeverity;
  title: string;
  description: string;
  configurationId?: string;
  nodeIds?: NodeId[];
  fixAction?: ExportFixAction;
  /** Whether the user may explicitly override this finding. */
  canIgnore: boolean;
}

export interface ExportPreflightResult {
  findings: ExportFinding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** True when any error-level finding exists (plan cannot proceed without override). */
  blocked: boolean;
}

export interface ExportPreflightOptions {
  platform?: PlatformKind;
  /** Installed font family names. When absent, font checks are skipped. */
  availableFonts?: Set<string>;
  selectionIds?: NodeId[];
  documentNodeIds?: NodeId[];
  /** Memory guard: warn when a single output exceeds this many pixels. */
  maxPixels?: number;
}

const DEFAULT_MAX_PIXELS = 33_554_432; // 32 Mi pixels, matches raster surface policy

// ── Runner ──────────────────────────────────────────────────────────────────

export function runExportPreflight(
  document: Document,
  request: ExportBatchRequest,
  options: ExportPreflightOptions = {},
): ExportPreflightResult {
  const plan = buildExportPlan(document, request, {
    document,
    selectionIds: options.selectionIds,
    documentNodeIds: options.documentNodeIds,
    platform: options.platform,
  });

  const findings: ExportFinding[] = [];

  for (const error of plan.errors) {
    findings.push({
      id: findingId(error.code, error.configurationId),
      code: error.code,
      severity: 'error',
      title: errorTitle(error.code),
      description: error.message,
      configurationId: error.configurationId,
      canIgnore: error.code !== 'format-unsupported',
    });
  }

  for (const item of plan.items) {
    pushItemFindings(findings, document, item, options);
  }

  pushCollisionFindings(findings, plan);

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  return {
    findings,
    errorCount,
    warningCount,
    infoCount,
    blocked: errorCount > 0,
  };
}

function pushItemFindings(
  findings: ExportFinding[],
  document: Document,
  item: ExportJobSpec,
  options: ExportPreflightOptions,
): void {
  const platform = options.platform ?? 'web';
  const capability = capabilitiesForFormat(item.format, platform);

  pushDimensionFindings(findings, item, options.maxPixels ?? DEFAULT_MAX_PIXELS);
  pushInvisibleOutputFindings(findings, item, capability);
  pushColorFindings(findings, document, item);
  pushFontFindings(findings, document, item, options.availableFonts);
  pushRasterizationFindings(findings, document, item, capability);
  pushPrintFindings(findings, item);
  pushRasterResolutionFindings(findings, document, item);
  pushFormatSpecificFindings(findings, item, capability, platform);
}

// ── Individual rule groups ──────────────────────────────────────────────────

function pushDimensionFindings(
  findings: ExportFinding[],
  item: ExportJobSpec,
  maxPixels: number,
): void {
  const pixels = item.resolvedDimensions.width * item.resolvedDimensions.height;
  if (item.dimensionsClamped && item.requestedDimensions) {
    findings.push({
      id: findingId('output-dimension-clamped', item.configurationId),
      code: 'output-dimension-clamped',
      severity: 'warning',
      title: 'Output dimensions were limited',
      description:
        `The requested output was ${item.requestedDimensions.width} × ${item.requestedDimensions.height}px, ` +
        `but this format is limited to ${item.resolvedDimensions.width} × ${item.resolvedDimensions.height}px.`,
      configurationId: item.configurationId,
      nodeIds: item.nodeId ? [item.nodeId] : undefined,
      canIgnore: true,
    });
  }
  if (pixels > maxPixels) {
    findings.push({
      id: findingId('memory-risk', item.configurationId),
      code: 'memory-risk',
      severity: 'warning',
      title: 'Large output size',
      description:
        `This output is ${item.resolvedDimensions.width} × ${item.resolvedDimensions.height}px ` +
        `(${Math.round(pixels / 1_000_000)} MP), above the ${Math.round(maxPixels / 1_000_000)} MP ` +
        `guidance. The export may use significant memory and take a while.`,
      configurationId: item.configurationId,
      nodeIds: item.nodeId ? [item.nodeId] : undefined,
      canIgnore: true,
    });
  }
}

function pushInvisibleOutputFindings(
  findings: ExportFinding[],
  item: ExportJobSpec,
  capability: FormatCapability,
): void {
  if (!capability.transparency && !item.background.color) {
    findings.push({
      id: findingId('transparent-background-flattened', item.configurationId),
      code: 'transparent-background-flattened',
      severity: 'info',
      title: 'Transparency will be flattened',
      description:
        `${item.format.toUpperCase()} does not support transparency; the transparent ` +
        `background will be flattened to opaque. Choose a background color to control the result.`,
      configurationId: item.configurationId,
      nodeIds: item.nodeId ? [item.nodeId] : undefined,
      canIgnore: true,
    });
  }
}

function pushColorFindings(
  findings: ExportFinding[],
  document: Document,
  item: ExportJobSpec,
): void {
  const color = item.color;
  const isCmykFormat = item.format === 'pdf-x1a' || item.format === 'pdf-x3';

  if (isCmykFormat && color.profile !== 'cmyk') {
    findings.push({
      id: findingId('rgb-in-cmyk', item.configurationId),
      code: 'rgb-in-cmyk',
      severity: 'warning',
      title: 'RGB content in CMYK output',
      description:
        `${item.format.toUpperCase()} requires CMYK. Content will be converted from ` +
        `${color.profile} using the selected output profile. Verify the conversion matches your print intent.`,
      configurationId: item.configurationId,
      nodeIds: item.nodeId ? [item.nodeId] : undefined,
      fixAction: { type: 'convert-color-space', target: 'cmyk' },
      canIgnore: true,
    });
  }

  if (color.profile === 'cmyk' && !color.iccProfile) {
    findings.push({
      id: findingId('cmyk-missing-profile', item.configurationId),
      code: 'cmyk-missing-profile',
      severity: 'warning',
      title: 'Missing CMYK output profile',
      description: 'CMYK conversion has no output ICC profile; a default profile will be used.',
      configurationId: item.configurationId,
      canIgnore: true,
    });
  }

  if (color.profile === 'cmyk' && color.convertToDestination === false && !isCmykFormat) {
    findings.push({
      id: findingId('cmyk-tagged-only', item.configurationId),
      code: 'cmyk-tagged-only',
      severity: 'info',
      title: 'CMYK colors tagged, not converted',
      description:
        'The output is being tagged with a CMYK profile, but content is not converted to the destination space.',
      configurationId: item.configurationId,
      canIgnore: true,
    });
  }

  if (document.spotColors && document.spotColors.length > 0 && !supportsSpotColors(item.format)) {
    findings.push({
      id: findingId('spot-color-unsupported', item.configurationId),
      code: 'spot-color-unsupported',
      severity: 'warning',
      title: 'Spot colors not supported by format',
      description:
        `This document defines ${document.spotColors.length} spot color(s), but ${item.format.toUpperCase()} ` +
        'does not preserve spot separations. Spot colors will be converted to process equivalents.',
      configurationId: item.configurationId,
      canIgnore: true,
    });
  }
}

function pushFontFindings(
  findings: ExportFinding[],
  document: Document,
  item: ExportJobSpec,
  availableFonts: Set<string> | undefined,
): void {
  if (!availableFonts) return;
  if (!item.nodeId) return;

  const entries = walkNodes(document, [item.nodeId]);
  const missing = new Map<string, NodeId[]>();

  for (const entry of entries.values()) {
    const node = entry.node;
    if (node.kind !== 'text') continue;
    const nodeFamily = (node as { fontFamily?: string }).fontFamily;
    if (nodeFamily && !availableFonts.has(nodeFamily)) {
      pushMissing(missing, nodeFamily, node.id);
    }
    const richText = (
      node as {
        richText?: { paragraphs: Array<{ runs: Array<{ format?: { fontFamily?: string } }> }> };
      }
    ).richText;
    for (const para of richText?.paragraphs ?? []) {
      for (const run of para.runs) {
        const family = run.format?.fontFamily;
        if (family && !availableFonts.has(family)) pushMissing(missing, family, node.id);
      }
    }
  }

  for (const [family, nodeIds] of missing) {
    findings.push({
      id: findingId('missing-font', item.configurationId, nodeIds),
      code: 'missing-font',
      severity: 'warning',
      title: 'Missing font',
      description:
        `Font "${family}" is not available on this device. Text using it may render differently ` +
        'or fall back to a substitute font in the exported file.',
      configurationId: item.configurationId,
      nodeIds,
      fixAction: { type: 'outline-text', nodeIds },
      canIgnore: true,
    });
  }
}

function pushMissing(map: Map<string, NodeId[]>, family: string, nodeId: NodeId): void {
  const list = map.get(family) ?? [];
  list.push(nodeId);
  map.set(family, list);
}

function pushRasterizationFindings(
  findings: ExportFinding[],
  document: Document,
  item: ExportJobSpec,
  capability: FormatCapability,
): void {
  if (capability.vector === 'native' && capability.filters === 'native') return;
  if (!item.nodeId) return;

  const needsRaster: NodeId[] = [];
  for (const entry of walkNodes(document, [item.nodeId]).values()) {
    const node = entry.node;
    const hasEffects =
      'effects' in node &&
      Array.isArray(node.effects) &&
      node.effects.some((e: { visible?: boolean }) => e.visible !== false);
    const hasBlend =
      'blendMode' in node && node.blendMode !== 'normal' && node.blendMode !== 'passThrough';
    if (hasEffects && capability.filters !== 'native') needsRaster.push(node.id);
    if (hasBlend && capability.blendModes !== 'native') needsRaster.push(node.id);
    if (node.kind === 'adjustment' && capability.adjustmentLayers === 'blocked') {
      findings.push({
        id: findingId('adjustment-blocked', item.configurationId, [node.id]),
        code: 'adjustment-blocked',
        severity: 'error',
        title: 'Adjustment layer not supported by format',
        description: `${item.format.toUpperCase()} cannot preserve adjustment layers; the affected subtree must be rasterized.`,
        configurationId: item.configurationId,
        nodeIds: [node.id],
        fixAction: { type: 'flatten-raster', nodeIds: [node.id] },
        canIgnore: true,
      });
    }
  }

  if (needsRaster.length > 0) {
    findings.push({
      id: findingId('subtree-rasterized', item.configurationId, needsRaster),
      code: 'subtree-rasterized',
      severity: 'info',
      title: 'Some content will be rasterized',
      description:
        `${needsRaster.length} node(s) use effects or blend modes that ${item.format.toUpperCase()} ` +
        'cannot preserve; only those subtrees will be flattened to raster. The rest stays vector.',
      configurationId: item.configurationId,
      nodeIds: needsRaster,
      fixAction: { type: 'flatten-raster', nodeIds: needsRaster },
      canIgnore: true,
    });
  }
}

function pushPrintFindings(findings: ExportFinding[], item: ExportJobSpec): void {
  const print = item.print;
  if (!print) return;

  if (print.includeCropMarks && print.bleedMm <= 0) {
    findings.push({
      id: findingId('missing-bleed', item.configurationId),
      code: 'missing-bleed',
      severity: 'warning',
      title: 'Crop marks without bleed',
      description:
        'Crop marks are requested but no bleed is configured. Printers expect content to extend into a bleed area.',
      configurationId: item.configurationId,
      canIgnore: true,
    });
  }

  if (print.includeCropMarks && !print.convertToDestination) {
    findings.push({
      id: findingId('print-color-not-converted', item.configurationId),
      code: 'print-color-not-converted',
      severity: 'info',
      title: 'Print colors not converted to destination',
      description: 'The print job is not converting content to the output color space.',
      configurationId: item.configurationId,
      canIgnore: true,
    });
  }
}

function pushRasterResolutionFindings(
  findings: ExportFinding[],
  document: Document,
  item: ExportJobSpec,
): void {
  const targetPpi =
    item.print?.enforceDpi ?? (item.rasterized ? item.outputResolutionPpi : undefined);
  if (!targetPpi || !item.nodeId) return;

  for (const entry of walkNodes(document, [item.nodeId]).values()) {
    if (entry.node.kind !== 'shape') continue;
    const effective = effectiveRasterPpiForNode(document, entry.node);
    if (!effective?.available || effective.minimumPpi >= targetPpi) continue;
    findings.push({
      id: findingId('low-effective-resolution', item.configurationId, [entry.node.id]),
      code: 'low-effective-resolution',
      severity: 'warning',
      title: 'Raster source may appear soft',
      description:
        `"${entry.node.name}" has approximately ${Math.round(effective.minimumPpi)} effective PPI ` +
        `at its placed size, below the ${targetPpi} PPI target. Reduce its placed size, lower ` +
        'the output target, or intentionally resample/enhance the source.',
      configurationId: item.configurationId,
      nodeIds: [entry.node.id],
      canIgnore: true,
    });
  }
}

function pushFormatSpecificFindings(
  findings: ExportFinding[],
  item: ExportJobSpec,
  _capability: FormatCapability,
  platform: PlatformKind,
): void {
  if (!formatSupportedOnPlatform(item.format, platform)) {
    const cap = capabilitiesForFormat(item.format, platform);
    findings.push({
      id: findingId('format-platform-unavailable', item.configurationId),
      code: 'format-platform-unavailable',
      severity: 'error',
      title: 'Format not available on this platform',
      description:
        `${cap.label} is only available in the ${platform === 'tauri' ? 'web' : 'desktop'} ` +
        'runtime. Switch the active platform or choose a format this platform can produce.',
      configurationId: item.configurationId,
      nodeIds: item.nodeId ? [item.nodeId] : undefined,
      canIgnore: false,
    });
  }

  if (item.format === 'gif') {
    findings.push({
      id: findingId('gif-static-frame', item.configurationId),
      code: 'gif-static-frame',
      severity: 'info',
      title: 'Static GIF frame',
      description:
        'A GIF exported from a static selection produces a single frame. Use a timeline for animation.',
      configurationId: item.configurationId,
      canIgnore: true,
    });
  }
}

// ── Collisions ──────────────────────────────────────────────────────────────

function pushCollisionFindings(findings: ExportFinding[], plan: ExportPlan): void {
  const seen = new Map<string, ExportJobSpec[]>();
  for (const item of plan.items) {
    const key = item.relativePath.toLocaleLowerCase();
    const list = seen.get(key) ?? [];
    list.push(item);
    seen.set(key, list);
  }

  for (const [key, items] of seen) {
    if (items.length < 2) continue;
    findings.push({
      id: `path-collision:${key}`,
      code: 'path-collision',
      severity: 'error',
      title: 'Duplicate output path',
      description:
        `${items.length} configurations resolve to the same path "${items[0]?.relativePath}". ` +
        'Use distinct suffixes, scales, or a collision policy to avoid overwriting files.',
      configurationId: items[0]?.configurationId,
      nodeIds: items.map((i) => i.nodeId).filter((id): id is NodeId => Boolean(id)),
      canIgnore: false,
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function supportsSpotColors(format: ExportFormat): boolean {
  return format === 'pdf' || format === 'pdf-x1a' || format === 'pdf-x3' || format === 'pdf-x4';
}

function findingId(code: string, configurationId: string, nodeIds: NodeId[] = []): string {
  return `${code}:${configurationId}${nodeIds.length > 0 ? `:${nodeIds.join(',')}` : ''}`;
}

function errorTitle(code: string): string {
  switch (code) {
    case 'format-unsupported':
      return 'Format not available';
    case 'target-empty':
      return 'Empty export target';
    case 'bounds-empty':
      return 'Could not determine export bounds';
    default:
      return 'Export configuration error';
  }
}
