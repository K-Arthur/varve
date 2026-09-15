/**
 * Export plan normalization (Strata export rebuild, M3).
 *
 * Separates export *intent* (configurations) from export *execution* (job
 * specs). This module resolves:
 *
 *   targets → node ids
 *   bounds policy → concrete world-space rectangle
 *   scale → pixel factor and output dimensions (with format caps)
 *   naming → deterministic sanitized relative paths
 *   color/background defaults → concrete settings
 *   capability requirements → engine/manifest/rasterization flags
 *
 * The UI must never need to understand renderer internals, and renderers must
 * never infer ambiguous intent from raw settings. The plan is pure and
 * deterministic for tests.
 *
 * Bounds sources:
 *  - object   nominal bounds (no effect overflow)
 *  - visual   nominal bounds + effect overflow (blur/shadow/glow spread)
 *  - frame    frame node world bounds
 *  - page     page trim box
 *  - page-bleed page + configured bleed
 *  - custom   explicit rect from the plan context
 *
 * Unresolvable targets produce {@link ExportPlanError}s, never silent drops.
 */

import { activePageNodesWithMaster, type Document } from '../document';
import { spreadsFromProjection } from '../document-pages';
import { computeFlattenBounds } from '../flatten/bounds';
import { PageRangeError, parsePageRange, resolvePageRange } from '../pageRange';
import { pageBleedInsetsPx } from '../printGeometry';
import type { NodeId } from '../types';
import { capabilitiesForFormat, type PlatformKind, RASTER_MAX_PIXELS } from './capabilities';
import {
  createExportColorSettings,
  createRasterExportSettings,
  type ExportBatchRequest,
  type ExportBoundsPolicy,
  type ExportConfiguration,
  type ExportFormat,
  type ExportJobSpec,
  type ExportPageUnit,
  type ExportScale,
  type ExportTarget,
  exportTargetKind,
  type PrintExportSettings,
} from './model';
import { extensionForFormat, type FileNameContext, formatFileName } from './naming';
import {
  physicalSizeForDocumentBounds,
  physicalToDocumentPx,
  REFERENCE_PPI,
  resolveExportScale,
} from './resolution';

// ── Errors ──────────────────────────────────────────────────────────────────

export interface ExportPlanError {
  configurationId: string;
  code: string;
  message: string;
}

export interface ExportPlan {
  requestId: string;
  items: ExportJobSpec[];
  errors: ExportPlanError[];
  createdAt: number;
}

export interface ResolvedTarget {
  kind: 'node' | 'page' | 'document';
  nodeIds: NodeId[];
  pageId?: string;
  pageIds?: NodeId[];
  pageUnits?: ExportPageUnit[];
  name: string;
}

export interface ExportPageSelectionIssue {
  code:
    | 'page-missing'
    | 'page-excluded'
    | 'page-range-invalid'
    | 'page-range-empty'
    | 'spread-page-missing'
    | 'spread-page-excluded';
  pageIds?: NodeId[];
  message: string;
}

/**
 * The page-aware part of an export target. This is intentionally independent
 * of a renderer: one selected page may become one PDF page, while a reader
 * spread may become one output unit later without changing selection rules.
 */
export interface ExportPageSelection {
  source: 'page' | 'pages' | 'document';
  pageIds: NodeId[];
  units: ExportPageUnit[];
  requestedPageIds: NodeId[];
  excludedPageIds: NodeId[];
  missingPageIds: NodeId[];
  issues: ExportPageSelectionIssue[];
}

// ── Context ─────────────────────────────────────────────────────────────────

export interface PlanContext {
  document: Document;
  /** Current selection ids (used for `selection` targets). */
  selectionIds?: NodeId[];
  /** Nodes included for `document` targets (default: all root children). */
  documentNodeIds?: NodeId[];
  /** Active page used by the `current` page-range expression. */
  activePageId?: NodeId;
  /** Page ids selected in the Pages panel, used by `selected`. */
  selectedPageIds?: NodeId[];
  platform?: PlatformKind;
  /** Custom bounds used when the configuration's policy is `custom`. */
  customBounds?: { x: number; y: number; width: number; height: number };
  /** Index for {index} token (1-based). */
  startIndex?: number;
}

/**
 * Resolve the page portion of an export intent in document order.
 *
 * Page exclusion is a document-level authoring choice. It is respected by
 * default; a target must explicitly opt into `includeExcludedPages`. Range
 * expressions use the canonical display-number resolver, while the older
 * numeric `{ from, to }` form remains an ordinal document-order range.
 */
export function resolveExportPageSelection(
  doc: Document,
  target: ExportTarget,
  ctx: PlanContext,
  print?: PrintExportSettings,
): ExportPageSelection | null {
  const pages = doc.pages ?? [];
  // A flat document's `document` target still means its root scene. There is
  // no page scope to resolve, so leave it to the existing node-target path.
  if (target.type === 'document' && pages.length === 0) return null;
  let requestedPageIds: NodeId[];
  let source: ExportPageSelection['source'];

  switch (target.type) {
    case 'page':
      source = 'page';
      requestedPageIds = [target.pageId];
      break;
    case 'pages':
      source = 'pages';
      requestedPageIds = target.pageIds;
      break;
    case 'document':
      source = 'document';
      requestedPageIds = pages.map((page) => page.id);
      break;
    default:
      return null;
  }

  const pageById = new Map(pages.map((page) => [page.id, page]));
  const missingPageIds = uniqueIds(requestedPageIds.filter((id) => !pageById.has(id)));
  const requestedSet = new Set(requestedPageIds);
  const scopedPages = pages.filter((page) => requestedSet.has(page.id));
  const issues: ExportPageSelectionIssue[] = [];

  if (missingPageIds.length > 0) {
    issues.push({
      code: 'page-missing',
      pageIds: missingPageIds,
      message: `The export target references missing page${missingPageIds.length === 1 ? '' : 's'}: ${missingPageIds.join(', ')}.`,
    });
  }

  let rangePageIds = scopedPages.map((page) => page.id);
  const rangeExpression = print?.pageRangeExpression?.trim();
  if (rangeExpression) {
    try {
      const spec = parsePageRange(rangeExpression);
      const resolved =
        spec.kind === 'selected' && ctx.selectedPageIds
          ? pages.filter((page) => ctx.selectedPageIds?.includes(page.id)).map((page) => page.id)
          : resolvePageRange(doc, spec, {
              activePageId: ctx.activePageId ?? doc.activePageId,
              selectedNodeIds: ctx.selectionIds,
            });
      rangePageIds = scopedPages
        .filter((page) => new Set(resolved).has(page.id))
        .map((page) => page.id);
      if (rangePageIds.length === 0) {
        issues.push({
          code: 'page-range-empty',
          message: `Page range "${rangeExpression}" does not select any page in this target.`,
        });
      }
    } catch (error) {
      const message = error instanceof PageRangeError ? error.message : String(error);
      issues.push({
        code: 'page-range-invalid',
        message: `Invalid page range "${rangeExpression}": ${message}`,
      });
      rangePageIds = [];
    }
  } else if (print?.pageRange) {
    const { from, to } = print.pageRange;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      issues.push({
        code: 'page-range-invalid',
        message: 'Page range must use positive integer bounds with from less than or equal to to.',
      });
      rangePageIds = [];
    } else {
      rangePageIds = scopedPages
        .filter((page) => {
          const ordinal = pages.findIndex((candidate) => candidate.id === page.id) + 1;
          return ordinal >= from && ordinal <= to;
        })
        .map((page) => page.id);
      if (rangePageIds.length === 0) {
        issues.push({
          code: 'page-range-empty',
          message: `Page range ${from}-${to} does not select any page in this target.`,
        });
      }
    }
  }

  const includeExcludedPages =
    (target.type === 'page' || target.type === 'pages' || target.type === 'document') &&
    target.includeExcludedPages === true;
  const rangeSet = new Set(rangePageIds);
  const selectedPages = scopedPages.filter((page) => rangeSet.has(page.id));
  const excludedPageIds = selectedPages
    .filter((page) => page.printSettings?.excludeFromExport)
    .map((page) => page.id);
  if (excludedPageIds.length > 0 && !includeExcludedPages) {
    issues.push({
      code: 'page-excluded',
      pageIds: excludedPageIds,
      message: `Excluded page${excludedPageIds.length === 1 ? '' : 's'} were omitted from export: ${excludedPageIds.join(', ')}.`,
    });
  }

  const eligiblePages = selectedPages.filter(
    (page) => includeExcludedPages || !page.printSettings?.excludeFromExport,
  );
  const units = print?.spreads
    ? resolveSpreadUnits(doc, eligiblePages, includeExcludedPages, issues)
    : eligiblePages.map((page) => ({ kind: 'page' as const, pageIds: [page.id] }));
  const pageIds = units.flatMap((unit) => unit.pageIds);

  return {
    source,
    pageIds,
    units,
    requestedPageIds,
    excludedPageIds: uniqueIds([
      ...excludedPageIds,
      ...issues
        .filter((issue) => issue.code === 'spread-page-excluded')
        .flatMap((issue) => issue.pageIds ?? []),
    ]),
    missingPageIds,
    issues: dedupeSelectionIssues(issues),
  };
}

function resolveSpreadUnits(
  doc: Document,
  eligiblePages: Document['pages'],
  includeExcludedPages: boolean,
  issues: ExportPageSelectionIssue[],
): ExportPageUnit[] {
  const pages = doc.pages ?? [];
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const eligibleIds = new Set(eligiblePages?.map((page) => page.id) ?? []);
  const spreads = doc.spreadModel === 'custom' ? (doc.spreads ?? []) : spreadsFromProjection(doc);
  const units: Array<{ unit: ExportPageUnit; firstIndex: number }> = [];
  const visited = new Set<NodeId>();

  for (const page of eligiblePages ?? []) {
    if (visited.has(page.id)) continue;
    const spread = spreads.find((candidate) => candidate.pageIds.includes(page.id));
    const memberIds = spread?.pageIds ? [...spread.pageIds] : [page.id];
    const missingIds = memberIds.filter((id) => !pageById.has(id));
    if (missingIds.length > 0) {
      issues.push({
        code: 'spread-page-missing',
        pageIds: missingIds,
        message: `Spread ${spread?.id ?? page.id} references missing page${missingIds.length === 1 ? '' : 's'}: ${missingIds.join(', ')}.`,
      });
      continue;
    }
    const excludedIds = memberIds.filter(
      (id) => !includeExcludedPages && pageById.get(id)?.printSettings?.excludeFromExport,
    );
    if (excludedIds.length > 0) {
      issues.push({
        code: 'spread-page-excluded',
        pageIds: excludedIds,
        message: `Spread ${spread?.id ?? page.id} was omitted because page${excludedIds.length === 1 ? '' : 's'} ${excludedIds.join(', ')} are excluded from export.`,
      });
      visited.add(page.id);
      continue;
    }
    const firstIndex = Math.min(
      ...memberIds.map((id) => pages.findIndex((candidate) => candidate.id === id)),
    );
    units.push({
      unit: {
        kind: memberIds.length > 1 ? 'spread' : 'page',
        pageIds: memberIds,
        ...(memberIds.length > 1 && spread ? { spreadId: spread.id } : {}),
      },
      firstIndex,
    });
    for (const id of memberIds) {
      if (eligibleIds.has(id)) visited.add(id);
    }
  }

  return units.sort((a, b) => a.firstIndex - b.firstIndex).map(({ unit }) => unit);
}

function uniqueIds(ids: NodeId[]): NodeId[] {
  return [...new Set(ids)];
}

function dedupeSelectionIssues(issues: ExportPageSelectionIssue[]): ExportPageSelectionIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${(issue.pageIds ?? []).join(',')}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Target resolution ───────────────────────────────────────────────────────

export function resolveTarget(
  doc: Document,
  target: ExportTarget,
  ctx: PlanContext,
): ResolvedTarget {
  switch (target.type) {
    case 'selection': {
      const ids = (target.nodeIds ?? ctx.selectionIds ?? []).filter((id) => doc.nodes[id]);
      return { kind: 'node', nodeIds: ids, name: nameForNode(doc, ids[0]) ?? 'Selection' };
    }
    case 'node':
    case 'frame': {
      const node = doc.nodes[target.nodeId];
      return {
        kind: 'node',
        nodeIds: node ? [target.nodeId] : [],
        name: node?.name ?? target.nodeId,
      };
    }
    case 'slice': {
      // Slices are not yet modeled as first-class objects; a slice id that
      // matches a node id resolves to that node, otherwise the target is empty
      // (surfaced as an error by the caller).
      const node = doc.nodes[target.sliceId];
      return {
        kind: 'node',
        nodeIds: node ? [target.sliceId] : [],
        name: node?.name ?? target.sliceId,
      };
    }
    case 'page': {
      const page = doc.pages?.find((p) => p.id === target.pageId);
      if (!page) return { kind: 'page', nodeIds: [], name: target.pageId };
      const nodeIds = collectPageNodeIds(doc, page.id);
      return { kind: 'page', nodeIds, pageId: page.id, name: page.name };
    }
    case 'pages': {
      const pages = target.pageIds
        .map((id) => doc.pages?.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
      if (pages.length === 0) {
        return { kind: 'page', nodeIds: [], name: 'Pages' };
      }
      const nodeIds = pages.flatMap((page) => collectPageNodeIds(doc, page.id));
      return {
        kind: 'page',
        nodeIds,
        pageId: pages[0]?.id,
        name: pages.map((p) => p.name).join('+') || 'Pages',
      };
    }
    case 'document': {
      const ids = ctx.documentNodeIds ?? doc.rootChildren ?? [];
      return { kind: 'document', nodeIds: ids, name: doc.name ?? 'Document' };
    }
  }
}

function collectPageNodeIds(doc: Document, pageId: string): NodeId[] {
  const page = doc.pages?.find((p) => p.id === pageId);
  if (!page) return [];
  // Use the same page projection as the canvas so page exports include global
  // content, inherited master content, and page-local content. The projected
  // list is still node ids; placement and page boxes remain export policy.
  const contentRoot = doc.nodes[page.contentRoot];
  const localChildren =
    contentRoot && 'children' in contentRoot ? new Set(contentRoot.children) : new Set<NodeId>();
  const projected = activePageNodesWithMaster(doc, pageId).filter((id) => !localChildren.has(id));
  return [...new Set([...page.backgrounds, ...projected, page.contentRoot])];
}

function nameForNode(doc: Document, id: NodeId | undefined): string | undefined {
  return id ? doc.nodes[id]?.name : undefined;
}

// ── Bounds resolution ───────────────────────────────────────────────────────

export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function resolveBoundsRect(
  doc: Document,
  target: ResolvedTarget,
  policy: ExportBoundsPolicy,
  ctx: PlanContext,
): BoundsRect | null {
  switch (policy) {
    case 'object': {
      const b = computeFlattenBounds(doc, target.nodeIds, false);
      return b ? toBoundsRect(b) : null;
    }
    case 'visual': {
      const b = computeFlattenBounds(doc, target.nodeIds, true);
      return b ? toBoundsRect(b) : null;
    }
    case 'frame': {
      // Frame nodes export their own bounds; otherwise fall back to object.
      const frameId = target.nodeIds.find((id) => doc.nodes[id]?.kind === 'frame');
      const b = computeFlattenBounds(doc, frameId ? [frameId] : target.nodeIds, false);
      return b ? toBoundsRect(b) : null;
    }
    case 'custom':
      return ctx.customBounds ? { ...ctx.customBounds } : null;
    case 'slice': {
      const b = computeFlattenBounds(doc, target.nodeIds, true);
      return b ? toBoundsRect(b) : null;
    }
    case 'page':
    case 'page-bleed': {
      const page = target.pageId ? doc.pages?.find((p) => p.id === target.pageId) : undefined;
      if (!page) {
        const b = computeFlattenBounds(doc, target.nodeIds, false);
        return b ? toBoundsRect(b) : null;
      }
      // Bleed expansion comes from the canonical print-geometry resolver
      // (document px, per-edge, per-unit) — never from a local dpi/25.4
      // formula that could drift from the canvas preview.
      const insets = pageBleedInsetsPx(doc, page.id);
      const bleed = policy === 'page-bleed' ? insets : { top: 0, right: 0, bottom: 0, left: 0 };
      const origin = page.rulerOrigin ?? { x: 0, y: 0 };
      return {
        x: origin.x - bleed.left,
        y: origin.y - bleed.top,
        width: page.width + bleed.left + bleed.right,
        height: page.height + bleed.top + bleed.bottom,
      };
    }
  }
}

function toBoundsRect(b: { x: number; y: number; w: number; h: number }): BoundsRect {
  return { x: b.x, y: b.y, width: b.w, height: b.h };
}

// ── Scale resolution ────────────────────────────────────────────────────────

export function computeScaleFactor(
  scale: ExportScale,
  nominal: { width: number; height: number },
  _doc: Document,
): number {
  return resolveExportScale(scale, nominal).scaleFactor;
}

/** Convert one physical dimension to output pixels using the canonical model. */
export function physicalSizeToOutputPixels(
  value: number,
  unit: 'px' | 'in' | 'mm' | 'cm',
  targetPpi: number,
): number {
  const designPx = unit === 'px' ? value : physicalToDocumentPx(value, unit);
  return Math.round(designPx * (targetPpi / REFERENCE_PPI));
}

export interface ResolvedDimensions {
  requestedWidth: number;
  requestedHeight: number;
  width: number;
  height: number;
  /** Whether the result was clamped by a format limit. */
  clamped: boolean;
}

export function resolveDimensions(
  bounds: BoundsRect,
  scaleFactor: number,
  format: ExportFormat,
): ResolvedDimensions {
  const rawW = bounds.width * scaleFactor;
  const rawH = bounds.height * scaleFactor;
  const cap = capabilitiesForFormat(format).maxDimensions;
  const requestedWidth = Math.max(1, Math.round(rawW));
  const requestedHeight = Math.max(1, Math.round(rawH));
  let width = requestedWidth;
  let height = requestedHeight;
  let clamped = false;
  if (cap > 0) {
    if (width > cap) {
      height = Math.max(1, Math.round((height * cap) / width));
      width = cap;
      clamped = true;
    }
    if (height > cap) {
      width = Math.max(1, Math.round((width * cap) / height));
      height = cap;
      clamped = true;
    }
  }
  if (cap > 0 && width * height > RASTER_MAX_PIXELS) {
    const factor = Math.sqrt(RASTER_MAX_PIXELS / (width * height));
    width = Math.max(1, Math.floor(width * factor));
    height = Math.max(1, Math.floor(height * factor));
    clamped = true;
  }
  return { requestedWidth, requestedHeight, width, height, clamped };
}

// ── Plan builder ────────────────────────────────────────────────────────────

export function buildExportPlan(
  document: Document,
  request: ExportBatchRequest,
  ctx: PlanContext = { document },
): ExportPlan {
  const items: ExportJobSpec[] = [];
  const errors: ExportPlanError[] = [];
  let index = (ctx.startIndex ?? 1) - 1;

  for (const configuration of request.configurations) {
    if (!configuration.enabled) continue;
    const result = buildJobSpec(configuration, ctx, ++index);
    if (result.spec) items.push(result.spec);
    for (const error of result.errors) errors.push(error);
  }

  return {
    requestId: request.id,
    items,
    errors,
    createdAt: Date.now(),
  };
}

interface JobSpecResult {
  spec: ExportJobSpec | null;
  errors: ExportPlanError[];
}

export function buildJobSpec(
  configuration: ExportConfiguration,
  ctx: PlanContext,
  index: number,
): JobSpecResult {
  const errors: ExportPlanError[] = [];
  const reportError = (code: string, message: string) => {
    errors.push({ configurationId: configuration.id, code, message });
  };

  const format = configuration.format;
  const capability = capabilitiesForFormat(format, ctx.platform ?? 'web');

  if (!capability.supported) {
    reportError('format-unsupported', capability.reasonUnsupported ?? `${format} is not supported`);
    return { spec: null, errors };
  }

  let target = resolveTarget(ctx.document, configuration.target, ctx);
  const pageSelection = resolveExportPageSelection(
    ctx.document,
    configuration.target,
    ctx,
    configuration.print,
  );
  if (pageSelection) {
    for (const issue of pageSelection.issues) {
      reportError(issue.code, issue.message);
    }
    if (pageSelection.pageIds.length === 0) {
      if (pageSelection.issues.length === 0) {
        reportError(
          'target-empty',
          `Target resolved to no pages for configuration ${configuration.id}`,
        );
      }
      return { spec: null, errors };
    }
    const pageNames = pageSelection.pageIds
      .map((pageId) => ctx.document.pages?.find((page) => page.id === pageId)?.name)
      .filter((name): name is string => Boolean(name));
    target = {
      ...target,
      kind: target.kind === 'document' ? 'document' : 'page',
      nodeIds: pageSelection.pageIds.flatMap((pageId) => collectPageNodeIds(ctx.document, pageId)),
      pageId: pageSelection.pageIds[0],
      pageIds: pageSelection.pageIds,
      pageUnits: pageSelection.units,
      name: pageNames.join('+') || target.name,
    };
  }
  if (target.nodeIds.length === 0) {
    reportError(
      'target-empty',
      `Target resolved to no nodes for configuration ${configuration.id}`,
    );
    return { spec: null, errors };
  }

  const policy = configuration.bounds ?? 'visual';
  const bounds = resolveBoundsRect(ctx.document, target, policy, ctx);
  if (!bounds) {
    reportError('bounds-empty', `Could not resolve bounds for ${configuration.id}`);
    return { spec: null, errors };
  }

  const nominal = { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
  const resolvedScale = resolveExportScale(configuration.scale, nominal);
  const scaleFactor = resolvedScale.scaleFactor;
  const dimensions = resolveDimensions(bounds, scaleFactor, format);

  const color = configuration.color ?? createExportColorSettings();
  const raster =
    configuration.raster ??
    createRasterExportSettings({
      transparency: capability.transparency,
      stripMetadata: true,
    });
  const background = configuration.background ?? { transparent: capability.transparency };
  const requiresManifest = format === 'pdf' || format === 'pdf-x1a' || format === 'pdf-x4';
  const rasterized = capability.rasterizedByDefault;

  const fileNameContext: FileNameContext = {
    name: target.name,
    format,
    scale: configuration.scale,
    suffix: configuration.suffix,
    ext: extensionForFormat(format),
    index,
    pageNumber: target.kind === 'page' ? index : undefined,
    width: dimensions.width,
    height: dimensions.height,
    presetName: configuration.presetRef,
  };
  const template = configuration.filenameTemplate ?? '{name}{suffix}.{ext}';
  const relativePath = formatFileName(template, fileNameContext);

  return {
    spec: {
      id: `${configuration.id}-${index}`,
      configurationId: configuration.id,
      targetKind: exportTargetKind(configuration.target),
      name: target.name,
      nodeId: target.nodeIds[0],
      pageId: target.pageId,
      pageIds: target.pageIds,
      pageUnits: target.pageUnits,
      format,
      fileName: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      scaleFactor,
      requestedDimensions: {
        width: dimensions.requestedWidth,
        height: dimensions.requestedHeight,
      },
      resolvedDimensions: { width: dimensions.width, height: dimensions.height },
      dimensionsClamped: dimensions.clamped,
      outputResolutionPpi: resolvedScale.outputPpi,
      physicalSizeInches: (() => {
        const size = physicalSizeForDocumentBounds(bounds);
        return { width: size.widthInches, height: size.heightInches };
      })(),
      boundsRect: bounds,
      color,
      raster,
      vector: configuration.vector,
      print: configuration.print,
      metadata: configuration.metadata,
      background,
      bounds: policy,
      rasterized,
      rasterizedNodeIds: [],
      requiresImageManifest: requiresManifest,
    },
    errors,
  };
}
