/**
 * Asset export utilities — raster (PNG/JPG/WebP) via offscreen canvas and SVG
 * via codegen. All exports are local: no network round-trips.
 */

import { exportNodeToSvg } from '@varve/codegen';
import {
  applyRasterizationTransform,
  awaitExportsReady,
  collectFontData,
  convertExportImageData,
  createEngine,
  createRasterSurface,
  DEFAULT_RASTER_SURFACE_POLICY,
  type Engine,
  type SceneNode as EngineNode,
  type ExportFontRequest,
  encodeRasterSurface,
  exportColorPolicyLabel,
  exportProfileBytes,
  type FontDataRecord,
  fitRasterDimensions,
  fontReferenceKey,
  inheritedFontReference,
  insertJpegIccProfile,
  insertPngIccp,
  insertPngTextChunks,
  type MetadataContent,
  metadataToPngEntries,
  primitiveBounds,
  profileDescriptionFor,
  type RasterPipelineOptions,
  type RenderItem,
  resolveMetadataContent,
  runRasterPipeline,
  stripPngMetadata,
} from '@varve/engine';
import type { Document as SceneDocument, SceneNode, ShapeNode } from '@varve/scene';
import { effectPadding, imageFill } from '@varve/scene';
import type { MetadataPolicy } from '@varve/scene/export';
import { capabilitiesForFormat, sanitizeFileName, stripSourceExtension } from '@varve/scene/export';
import { DEFAULT_ARTWORK_FONT_FAMILY, transformRect, tryInvertAffine } from '@varve/shared';
import { appearancePaddingWorld, expandRect } from '../../canvas/visualBounds';
import {
  applyAiDisclosureToSvg,
  generateAiDisclosureXmp,
  getDocumentAiDisclosure,
} from '../../export/aiDisclosure';
import {
  composeFlattenedRasterAssetsForNode,
  findFlattenBoundaries,
} from '../../export/compositor';
import { prepareArtworkExport } from '../../export/conceptArtReferencePolicy';
import {
  buildPrintImageManifestForSrcs,
  buildPrintImageManifestFromPngBlob,
  collectImageFillSrcs,
  countPatternFillsWithoutTileSource,
} from '../../export/printImageManifest';
import { failureWarning, settleEngineImageResources } from '../../export/resourceReadiness';
import { insertJpegXmp, insertPdfXmp, insertPngXmp } from '../../export/xmpInjection';
import {
  clearMockupExportCache,
  collectMockupLiveSourceIds,
  decorateMockupSubtree,
  missingSurfaceWarning,
  settleMockupSurfaces,
  settleMockupTemplateAssets,
  subtreeNeedsDecoration,
} from '../../render/mockup/mockupExport';
import { replayStructuredScene } from '../../render/replayScene';
import { collectMaskSourceDependencies, flattenSceneToEngine } from '../../render/sceneToEngine';
import { nodeWorldTransform } from '../../scene/world';
import { worldBBox } from './measurement';
import { makeRasterImagePdf } from './rasterPdf';

export type RasterFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ExportOptions {
  format: RasterFormat;
  scale: number;
  quality?: number;
  transparency?: boolean;
  matteColor?: [number, number, number, number];
  /** Cancellation for the export barrier (resource settlement). */
  signal?: AbortSignal;
  /**
   * Canonical post-render pipeline (resize → sharpen → colour → dither).
   * When omitted the surface is encoded directly — matching today's behaviour
   * and keeping the no-op path free.
   */
  pipeline?: RasterPipelineOptions;
  /**
   * Colour policy for the exported raster: destination primaries +
   * optional ICC profile embedding. When `destination` is set, the rendered
   * sRGB composite is analytically converted to the destination encoding
   * before encoding; when `embedProfile` is set, an ICC profile is written
   * into the output (PNG iCCP / JPEG APP2). WebP cannot embed profiles on
   * this pipeline — a warning is emitted instead of a silent drop.
   */
  color?: import('@varve/engine').RasterExportColorPolicy;
  /** Metadata policy applied to the encoded PNG/JPEG bytes. */
  metadata?: { policy: MetadataPolicy; content?: MetadataContent };
  /** Include AI disclosure metadata (IPTC DigitalSourceType) if document contains AI edits. Defaults to true. */
  includeAiDisclosure?: boolean;
  /** Render a frame into its declared local width/height and clip exactly to that slide. */
  frameLocal?: boolean;
}

export interface RasterExportResult {
  blob: Blob;
  warnings: string[];
  /** Typed image-resource failures classified during export preflight. */
  resourceFailures: import('../../export/resourceReadiness').FailedResource[];
}

function collectEngineFonts(nodes: readonly EngineNode[]): ExportFontRequest[] {
  const requests: ExportFontRequest[] = [];
  for (const current of nodes) {
    if (current.kind !== 'text') continue;
    const family = current.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
    const weight = current.fontWeight ?? 400;
    const style = current.fontStyle === 'italic' ? 'italic' : 'normal';
    requests.push({
      family,
      weight,
      style,
      text: current.text ?? '',
      ...(current.fontReference ? { fontReference: current.fontReference } : {}),
    });
    for (const paragraph of current.richText?.paragraphs ?? []) {
      for (const run of paragraph.runs) {
        const runFamily = run.format?.fontFamily ?? family;
        const runReference = inheritedFontReference(
          family,
          current.fontReference,
          run.format?.fontFamily,
          run.format?.fontReference,
        );
        requests.push({
          family: runFamily,
          weight: run.format?.fontWeight ?? weight,
          style: run.format?.fontStyle === 'italic' ? 'italic' : style,
          text: run.text,
          ...(runReference ? { fontReference: runReference } : {}),
        });
      }
    }
  }
  return requests;
}

function exportFontRequestKey(request: ExportFontRequest): string {
  return request.fontReference
    ? `${request.family.toLowerCase()}\u0000${fontReferenceKey(request.fontReference)}`
    : request.family.toLowerCase();
}

/**
 * Ensure every authored exact face has verified bytes before a vector export.
 * The native PDF wire format is family-addressed for compatibility; embedding
 * two different artifacts under one family would therefore make rich runs
 * silently use the first file. Block that ambiguous export with a repairable
 * message instead of claiming a successful file.
 */
export function assertExportFontData(
  requests: readonly ExportFontRequest[],
  records: readonly FontDataRecord[],
): void {
  const unique = new Map<string, ExportFontRequest>();
  for (const request of requests) unique.set(exportFontRequestKey(request), request);
  const recordKeys = new Set(records.map((record) => exportFontRequestKey(record)));
  const missing = [...unique.values()].filter(
    (request) => request.fontReference && !recordKeys.has(exportFontRequestKey(request)),
  );
  if (missing.length > 0) {
    const labels = missing
      .map((request) =>
        request.fontReference
          ? `${request.family} (${fontReferenceKey(request.fontReference)})`
          : request.family,
      )
      .join(', ');
    throw new Error(`Font export blocked: exact face bytes are unavailable for ${labels}.`);
  }
  const exactByFamily = new Map<string, Set<string>>();
  for (const request of unique.values()) {
    if (!request.fontReference) continue;
    const keys = exactByFamily.get(request.family.toLowerCase()) ?? new Set<string>();
    keys.add(fontReferenceKey(request.fontReference));
    exactByFamily.set(request.family.toLowerCase(), keys);
  }
  const ambiguous = [...exactByFamily.entries()].filter(([, keys]) => keys.size > 1);
  if (ambiguous.length > 0) {
    throw new Error(
      `Font export blocked: multiple exact faces share a family (${ambiguous.map(([family]) => family).join(', ')}). Choose outline or raster export, or replace the runs with one exact face.`,
    );
  }
}

function collectExportFontRequests(requests: readonly ExportFontRequest[]): ExportFontRequest[] {
  const unique = new Map<string, ExportFontRequest>();
  for (const request of requests) unique.set(exportFontRequestKey(request), request);
  return [...unique.values()];
}

function unionBounds(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * Add authored scene effects to export bounds, including effects owned by a
 * container. RenderItem bounds only describe flattened leaves, so relying on
 * them alone clips group-level blur, displacement, and glow spill.
 */
function sceneEffectPaddingWorld(node: SceneNode, doc: SceneDocument): number {
  if (!('effects' in node) || !node.effects?.length) return 0;
  let localPadding = 0;
  for (const effect of node.effects) {
    if (effect.visible === false) continue;
    const padding = effectPadding(effect);
    localPadding += Math.max(padding.left, padding.top, padding.right, padding.bottom);
  }
  const transform = nodeWorldTransform(doc, node.id);
  const scale = Math.max(
    Math.hypot(transform[0], transform[1]),
    Math.hypot(transform[2], transform[3]),
    1,
  );
  return localPadding * scale;
}

function expandSubtreeEffectBounds(
  node: SceneNode,
  doc: SceneDocument,
  initial: { x: number; y: number; w: number; h: number } | null,
): { x: number; y: number; w: number; h: number } | null {
  let bounds = initial;
  const stack = [node.id];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const current = doc.nodes[id];
    if (!current || current.visible === false) continue;
    if ('effects' in current && current.effects?.length) {
      const geometry = worldBBox(current, doc);
      const padding = sceneEffectPaddingWorld(current, doc);
      const visual = expandRect(geometry, padding);
      bounds = bounds ? unionBounds(bounds, visual) : visual;
    }
    if ('children' in current) stack.push(...current.children);
  }
  return bounds;
}

/**
 * An unwarped image or whole-pixel rectangle has declared raster extents.
 * Fractional world placement must not introduce an extra export row/column
 * with partial alpha. Effects, strokes, filters, warps, fractional geometry,
 * and resolved IR overflow retain conservative floor/ceil bounds.
 */
function hasAuthoredRectangleBounds(
  node: SceneNode,
  doc: SceneDocument,
  renderedBounds: { x: number; y: number; w: number; h: number } | null,
): boolean {
  if (node.kind !== 'shape' || node.shape.kind !== 'rect') return false;
  if (node.strokes?.some((stroke) => stroke.visible !== false)) return false;
  if (node.effects?.some((effect) => effect.visible !== false)) return false;
  if (
    node.smartFiltersEnabled !== false &&
    node.smartFilters?.some((filter) => filter.visible !== false)
  ) {
    return false;
  }
  if (node.warps?.length) return false;

  const transform = nodeWorldTransform(doc, node.id);
  const epsilon = 1e-9;
  if (Math.abs(transform[1]) > epsilon || Math.abs(transform[2]) > epsilon) return false;
  if (node.fills?.some((fill) => fill.type === 'image' && fill.image && fill.visible !== false)) {
    return true;
  }
  const authored = worldBBox(node, doc);
  // Preserve the existing conservative policy for genuinely fractional sizes.
  // Compare resolved IR bounds too: a reusable style can add appearance that
  // is absent from the authored node and still must not be clipped.
  return (
    !!renderedBounds &&
    Math.abs(authored.w - Math.round(authored.w)) <= epsilon &&
    Math.abs(authored.h - Math.round(authored.h)) <= epsilon &&
    Math.abs(renderedBounds.x - authored.x) <= epsilon &&
    Math.abs(renderedBounds.y - authored.y) <= epsilon &&
    Math.abs(renderedBounds.w - authored.w) <= epsilon &&
    Math.abs(renderedBounds.h - authored.h) <= epsilon
  );
}

/** Bounds of every pixel the resolved render IR may emit. */
function exportWorldBounds(
  node: SceneNode,
  doc: SceneDocument,
  flattenedIds: readonly string[],
  items: readonly RenderItem[],
  extraItems: readonly RenderItem[] = [],
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let bounds: { x: number; y: number; w: number; h: number } | null = null;
  for (const item of [...items, ...extraItems]) {
    const geometry = transformRect(item.transform, primitiveBounds(item.primitive));
    const visual = expandRect(geometry, appearancePaddingWorld(item, item.transform));
    bounds = bounds ? unionBounds(bounds, visual) : visual;
  }
  if (node.kind === 'frame' && node.clipContent !== false) {
    const rootIndex = flattenedIds.indexOf(node.id);
    const rootItem = rootIndex >= 0 ? items[rootIndex] : undefined;
    if (rootItem) {
      const geometry = transformRect(rootItem.transform, primitiveBounds(rootItem.primitive));
      bounds = expandRect(geometry, appearancePaddingWorld(rootItem, rootItem.transform));
    }
  }
  bounds = expandSubtreeEffectBounds(node, doc, bounds);
  if (hasAuthoredRectangleBounds(node, doc, bounds)) {
    // Keep the exact translated rectangle. The export crop follows authored
    // artwork rather than its incidental position on the world pixel grid.
    // The raster transform accepts a fractional origin; only target pixel
    // dimensions need rounding at the requested export scale.
    const authored = worldBBox(node, doc);
    return {
      x: authored.x,
      y: authored.y,
      w: Math.max(0, authored.w),
      h: Math.max(0, authored.h),
    };
  }
  bounds ??= worldBBox(node, doc);
  const x = Math.floor(bounds.x);
  const y = Math.floor(bounds.y);
  const maxX = Math.ceil(bounds.x + bounds.w);
  const maxY = Math.ceil(bounds.y + bounds.h);
  return {
    x,
    y,
    w: Math.max(0, maxX - x),
    h: Math.max(0, maxY - y),
  };
}

/** Deterministic static-export poster policy: usage poster frame (default 0). */
/** Deterministic static-export poster policy: usage poster frame (default 0). */
export function posterFrameResolver(
  _node: import('@varve/scene').SceneNode,
  fill: import('@varve/scene').Fill,
  _doc: import('../../render/sceneToEngine').AssetLookupDoc | undefined,
): number | undefined {
  if (fill.type !== 'image' || !fill.image) return undefined;
  if (!fill.image.assetId) return undefined;
  return fill.image.media?.posterFrame ?? 0;
}

export async function exportNodeAsRaster(
  node: SceneNode,
  doc: SceneDocument,
  eng: Engine,
  opts: ExportOptions,
): Promise<RasterExportResult> {
  ({ node, document: doc } = prepareArtworkExport(node, doc));
  // Resolve variants, bindings, reusable styles, and world transforms before
  // resource readiness. Waiting on the raw model can load a stale font/image
  // while the resolved render node uses a different resource.
  clearMockupExportCache();
  const mockupSourceIds = collectMockupLiveSourceIds(doc, [node.id]);
  const maskSourceIds = collectMaskSourceDependencies(doc, [node.id]);
  const flattened = flattenSceneToEngine(doc, [node.id, ...mockupSourceIds, ...maskSourceIds], {
    mediaFrameResolver: posterFrameResolver,
  });
  // Guard against exporting mid-font-swap: a font requested via fontFamily
  // may still be loading (bundled FontFace fetch, Google Fonts injection, or
  // a race right after the user picks a new typeface). Without this, text
  // silently renders with the fallback font and the export looks correct at
  // a glance but is wrong — deterministic export requires settled fonts.
  await awaitExportsReady(collectEngineFonts(flattened.nodes));

  const warnings: string[] = [];
  // Export barrier: no replay may begin until every required image resource
  // has settled (loaded, permanently failed, or timed out). Permanent
  // failures and pending resources are reported explicitly — the export
  // never silently omits an image, and never waits forever.
  const settlement = await settleEngineImageResources(flattened.nodes, {
    signal: opts.signal,
  });
  const resourceFailures =
    settlement.status === 'failed' || settlement.status === 'timeout'
      ? [...settlement.failures]
      : [];
  warnings.push(...resourceFailures.map((failure) => failureWarning(failure)));
  if (settlement.status === 'cancelled') {
    throw new DOMException('Export cancelled', 'AbortError');
  }
  if (settlement.status === 'timeout') {
    warnings.push(
      `Export proceeded while ${settlement.pending.length} image resource(s) were still loading; any that complete late cannot appear in this export. Run the export again once images are visible on canvas.`,
    );
  }

  // Template plates and masks live in the document asset table rather than
  // flattened image-fill nodes. Decode them before building export IR so a
  // first export cannot race lazy loading and omit a photographic plate or
  // foreground occluder.
  await settleMockupTemplateAssets(doc, [node.id, ...mockupSourceIds], {
    signal: opts.signal,
  });

  const ir = await eng.buildIr({ nodes: flattened.nodes });
  // Mockup + perspective decoration shares the canonical export pipeline
  // (`render/mockup/mockupExport.ts`) with SVG/PDF flatten boundaries, so a
  // PNG/JPG/WebP of a mockup frame is the composed mockup, not the frame's
  // own background. Missing sources are reported, never silently stale.
  const decoration = decorateMockupSubtree({
    doc,
    rootIds: [node.id, ...mockupSourceIds],
    flattenedIds: flattened.ids,
    items: ir,
    qualityScale: opts.scale,
    insertIntoList: false,
  });
  warnings.push(...decoration.missingSurfaces.map(missingSurfaceWarning));
  await settleMockupSurfaces(decoration.extrasByNodeId);
  const extraItems = [...decoration.extrasByNodeId.values()].flat();
  const frameNode = opts.frameLocal && node.kind === 'frame' ? node : undefined;
  const frameWorld = frameNode ? nodeWorldTransform(doc, frameNode.id) : undefined;
  const frameInverse = frameWorld ? tryInvertAffine(frameWorld) : undefined;
  if (frameWorld && !frameInverse) {
    throw new Error(`Frame “${node.name}” has a singular transform and cannot be captured.`);
  }
  const bbox = frameNode
    ? { x: 0, y: 0, w: frameNode.w, h: frameNode.h }
    : exportWorldBounds(node, doc, flattened.ids, ir, extraItems);

  let scale = opts.scale;
  const requestedW = Math.max(Math.round(bbox.w * scale), 1);
  const requestedH = Math.max(Math.round(bbox.h * scale), 1);
  const fitted = fitRasterDimensions(requestedW, requestedH);
  const w = fitted.width;
  const h = fitted.height;
  if (fitted.scaleFactor < 1) {
    scale = opts.scale * fitted.scaleFactor;
    warnings.push(
      `Requested ${requestedW}x${requestedH} export exceeded the portable raster safety policy (${DEFAULT_RASTER_SURFACE_POLICY.maxDimension}px per axis and ${DEFAULT_RASTER_SURFACE_POLICY.maxPixels.toLocaleString()} total pixels); scaled down to ${w}x${h} (effective ${scale.toFixed(3)}x of ${opts.scale}x) to avoid excessive memory use or a blank export.`,
    );
  }

  const transparent = opts.format !== 'image/jpeg' && (opts.transparency ?? true);
  // An alpha:false canvas is not a reliable matte: browser implementations may
  // still expose transparent initial pixels until something explicitly paints
  // them. Keep every opaque raster export deterministic instead of allowing an
  // implementation-defined black fill.
  const defaultFlattenMatte: [number, number, number, number] = [255, 255, 255, 255];
  const matteColor = opts.matteColor ?? (!transparent ? defaultFlattenMatte : undefined);
  const surface = createRasterSurface(w, h, { alpha: transparent });
  const ctx = surface.context;

  if (!transparent && matteColor) {
    const [r, g, b, a] = matteColor;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (!transparent && !opts.matteColor) {
    warnings.push(
      opts.format === 'image/jpeg'
        ? 'JPEG cannot carry transparency; no matte was supplied, so the export was flattened to white.'
        : `${opts.format} transparency was disabled; no matte was supplied, so the export was flattened to white.`,
    );
  }

  if (bbox.w > 0 && bbox.h > 0) {
    applyRasterizationTransform(
      ctx,
      {
        x: bbox.x,
        y: bbox.y,
        width: bbox.w,
        height: bbox.h,
      },
      { width: w, height: h },
    );
  } else {
    // A valid empty/degenerate selection still exports a 1x1 surface. The
    // strict raster transform rejects a zero source extent, so preserve the
    // legacy document-space translation for this compatibility case.
    ctx.setTransform(scale, 0, 0, scale, -bbox.x * scale, -bbox.y * scale);
  }

  if (frameWorld && frameInverse && frameNode) {
    ctx.transform(...frameInverse);
    // Clip in slide-local space while preserving the world-to-pixel transform
    // used by the scene IR. The composition returns to the exact local page
    // rectangle even when the frame sits on a Design Canvas or is rotated.
    ctx.save();
    ctx.transform(...frameWorld);
    ctx.beginPath();
    ctx.rect(0, 0, frameNode.w, frameNode.h);
    ctx.clip();
    ctx.restore();
  }

  replayStructuredScene(ctx, {
    document: doc,
    rootIds: [node.id],
    flattenedIds: flattened.ids,
    items: ir,
    extrasByNodeId: decoration.extrasByNodeId,
    quality: 'export',
  });

  // Canonical post-render processing (resize → sharpen → colour → dither).
  // Runs on the rendered surface; the result is written back before encoding.
  if (opts.pipeline) {
    const pixels = ctx.getImageData(0, 0, w, h);
    const processed = await runRasterPipeline(pixels, opts.pipeline);
    warnings.push(...processed.log.map((entry) => `pipeline: ${entry}`));
    ctx.putImageData(processed.imageData, 0, 0);
  }

  // Colour policy: analytically convert the rendered sRGB composite into the
  // requested destination encoding. The conversion is explicit and real
  // (matrix transform), never a relabel; authoritative document pixels are
  // untouched — only the exported bytes are transformed.
  if (opts.color) {
    const pixels = ctx.getImageData(0, 0, w, h);
    const colorWarnings = await convertExportImageData(pixels, opts.color, opts.signal);
    warnings.push(...colorWarnings);
    ctx.putImageData(pixels, 0, 0);
  }

  let blob: Blob;
  try {
    blob = await encodeRasterSurface(
      surface,
      opts.format,
      opts.quality ?? (opts.format === 'image/jpeg' ? 0.92 : undefined),
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'SecurityError') {
      throw new Error(
        'Export failed: this node includes a cross-origin image that does not permit CORS access, which taints the canvas and blocks pixel export. Re-import the image as a local asset, or ensure the image host sends permissive CORS headers.',
      );
    }
    throw err;
  }

  if (blob.type && blob.type !== opts.format) {
    warnings.push(
      `This runtime encoded ${blob.type} instead of the requested ${opts.format}; the file uses the actual encoded format.`,
    );
  }

  // ICC profile embedding on the encoded byte stream (never a pixel
  // re-encode). PNG uses the iCCP chunk; JPEG uses chunked APP2 segments.
  // WebP cannot carry a profile through canvas encoders — disclosed, not
  // silently dropped.
  if (opts.color?.embedProfile) {
    const profileBytes = exportProfileBytes(opts.color);
    if (profileBytes) {
      if (opts.format === 'image/png') {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const name = profileDescriptionFor(opts.color.destination ?? 'srgb');
        const embedded = await insertPngIccp(bytes, name, profileBytes);
        blob = new Blob([embedded.slice()], { type: 'image/png' });
        warnings.push(
          `colour: embedded ICC profile (${exportColorPolicyLabel(opts.color)}) in PNG output`,
        );
      } else if (opts.format === 'image/jpeg') {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const embedded = insertJpegIccProfile(bytes, profileBytes);
        blob = new Blob([embedded.slice()], { type: 'image/jpeg' });
        warnings.push(
          `colour: embedded ICC profile (${exportColorPolicyLabel(opts.color)}) in JPEG output`,
        );
      } else {
        warnings.push(
          'colour: WebP output cannot embed an ICC profile on this pipeline; the profile was not written (document pixels are unaffected)',
        );
      }
    } else {
      warnings.push(
        `colour: could not author an ICC profile for ${exportColorPolicyLabel(opts.color)}; output is untagged`,
      );
    }
  }

  // Metadata policy applied to the encoded bytes. Canvas encoders produce
  // metadata-free output; this adds exactly what the policy allows (PNG text
  // chunks) and strips any accidental ancillary chunks when the policy demands.
  if (opts.metadata && opts.format === 'image/png') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const resolved = resolveMetadataContent(opts.metadata.content, {
      policy: opts.metadata.policy,
    });
    if (opts.metadata.policy.kind === 'strip-all') {
      const stripped = stripPngMetadata(bytes, opts.metadata.policy.deterministic ? [] : ['iCCP']);
      blob = new Blob([stripped.slice()], { type: 'image/png' });
      warnings.push('metadata: stripped all metadata per export policy');
    } else {
      const entries = metadataToPngEntries(resolved);
      if (entries.length > 0) {
        const withText = insertPngTextChunks(bytes, entries);
        blob = new Blob([withText.slice()], { type: 'image/png' });
        warnings.push(
          `metadata: embedded ${entries.map((e) => e.keyword).join(', ')} per export policy`,
        );
      }
    }
  }

  // AI disclosure: embed XMP metadata if document contains AI edits and disclosure is enabled (default).
  if (opts.includeAiDisclosure !== false) {
    const disclosure = getDocumentAiDisclosure(doc, flattened.ids);
    if (disclosure) {
      const xmp = generateAiDisclosureXmp(disclosure);
      const bytes = new Uint8Array(await blob.arrayBuffer());

      if (opts.format === 'image/png') {
        const withXmp = insertPngXmp(bytes, xmp);
        blob = new Blob([withXmp.slice()], { type: 'image/png' });
        warnings.push(
          `AI disclosure: embedded IPTC DigitalSourceType metadata (${disclosure.tools.join(', ')})`,
        );
      } else if (opts.format === 'image/jpeg') {
        const withXmp = insertJpegXmp(bytes, xmp);
        blob = new Blob([withXmp.slice()], { type: 'image/jpeg' });
        warnings.push(
          `AI disclosure: embedded IPTC DigitalSourceType metadata (${disclosure.tools.join(', ')})`,
        );
      } else if (opts.format === 'image/webp') {
        warnings.push(
          'AI disclosure: WebP cannot embed XMP metadata via this pipeline; disclosure not written',
        );
      }
    }
  }

  return { blob, warnings, resourceFailures };
}

/**
 * SVG markup for one node, including the rasterized fallbacks SVG cannot
 * express natively (effects, composite gradients, mockups). This is the single
 * source of truth for both the Quick-export save and the copy action: calling
 * `exportNodeToSvg` without these assets silently drops the node's effect from
 * the copied markup while the saved file keeps it.
 */
export async function exportNodeToSvgMarkup(
  node: SceneNode,
  doc: SceneDocument,
  eng?: Engine,
  options: { includeAiDisclosure?: boolean } = {},
): Promise<string> {
  ({ node, document: doc } = prepareArtworkExport(node, doc));
  const rasterAssets = await composeFlattenedRasterAssetsForNode(node, doc, 'svg', {
    scale: 1,
    engine: eng,
  });
  const svg = exportNodeToSvg(node, doc, { rasterAssets });
  if (options.includeAiDisclosure === false) return svg;
  return applyAiDisclosureToSvg(svg, getDocumentAiDisclosure(doc, [node.id]));
}

export async function exportNodeAsSvg(
  node: SceneNode,
  doc: SceneDocument,
  eng?: Engine,
  options: { includeAiDisclosure?: boolean } = {},
): Promise<Blob> {
  return new Blob([await exportNodeToSvgMarkup(node, doc, eng, options)], {
    type: 'image/svg+xml',
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Filename for a quick export.
 *
 * Uses the canonical cross-platform sanitizer (`sanitizeSegment` /
 * `sanitizeFileName` in `@varve/scene/export`): Unicode is preserved, Windows
 * reserved device names are guarded, and a source-asset extension carried by
 * an imported layer name (`hero.jpg`) is dropped instead of being mangled into
 * the stem. `suffix` carries the scale token (`@2x`) so two quick exports of
 * the same object at different scales do not collide in the download folder.
 */
export function buildFilename(nodeName: string, ext: string, suffix = ''): string {
  const base = stripSourceExtension(nodeName).trim() || 'export';
  // keepDots matches the canonical template path (`formatFileName`), so a name
  // like `release.v1.2` reads the same in both export routes.
  return sanitizeFileName(`${base}${suffix}`, ext, { keepDots: true });
}

/**
 * Check whether a subtree requires raster fallback for PDF export.
 *
 * Uses the compositor for scene-level structural analysis (effects, masks,
 * adjustments, gradient types, rotation/skew) and supplements with
 * engine-level checks for properties only visible after flattening (fill
 * opacity/blend, node opacity/blend, filters, non-identity transforms).
 *
 * When any node or fill requires rasterization, the entire subtree is
 * rendered to a raster bitmap — strata-print cannot mix vector and raster
 * content in a single page.
 */
async function subtreeRequiresRasterPdfFallback(
  node: SceneNode,
  doc: SceneDocument,
): Promise<boolean> {
  // 1. Compositor: scene-level structural analysis
  const boundaries = findFlattenBoundaries([node], doc, 'pdf');
  if (boundaries.length > 0) return true;

  // 2. Engine-level checks for properties only visible after flattening
  const subtree = flattenSceneToEngine(doc, [node.id]);
  for (const sceneNode of subtree.nodes) {
    const [a, b, c, d] = sceneNode.transform;
    if (a !== 1 || b !== 0 || c !== 0 || d !== 1) return true;
    if ((sceneNode.opacity ?? 1) < 1) return true;
    if (sceneNode.blendMode && sceneNode.blendMode !== 'normal') return true;
    if ((sceneNode.filters?.length ?? 0) > 0) return true;
    if (
      sceneNode.fills?.some(
        (fill) =>
          fill.visible &&
          (fill.type !== 'solid' || fill.opacity < 1 || fill.blendMode !== 'normal'),
      )
    ) {
      return true;
    }
  }
  return false;
}

type TauriBridge = {
  core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
};

function getTauriBridge(): TauriBridge | undefined {
  return (window as unknown as Record<string, unknown>).__TAURI__ as TauriBridge | undefined;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to encode rasterized PDF fallback'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Rasterize a subtree and embed as PNG-in-PDF using a hand-written minimal
 * PDF writer. This is the browser-build fallback: it has no dependency on
 * the Tauri/Rust print engine, so it's the only option when `strata-print`
 * isn't reachable. Used as fallback when the Rust print engine cannot
 * represent features like filters, transparency, blends, non-identity
 * transforms, or text.
 */
async function rasterizeSubtreeToPdf(
  node: SceneNode,
  doc: SceneDocument,
  scale: number,
  eng: Engine,
): Promise<{ bytes: Uint8Array; pixelWidth: number; pixelHeight: number }> {
  const rasterResult = await exportNodeAsRaster(node, doc, eng, { format: 'image/png', scale });
  const blob = rasterResult.blob;
  const img = await createImageBitmap(blob);
  const pixelWidth = img.width;
  const pixelHeight = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, pixelWidth, pixelHeight);
  img.close();

  const pdfBytes = makeRasterImagePdf(imageData.data, imageData.width, imageData.height);
  return { bytes: pdfBytes, pixelWidth: imageData.width, pixelHeight: imageData.height };
}

/**
 * Rasterize a subtree and embed it via `strata-print`'s real image-embedding
 * path (colour-space handling, proper XObject placement) instead of the
 * hand-rolled minimal PDF writer — used whenever the Tauri desktop bridge is
 * available. The rasterized PNG is wrapped as a single ShapeNode with an
 * image fill (the same "flattened replacement node" shape the flatten/
 * rasterize/merge system uses) and sent through the existing vector PDF
 * command, so no new Rust surface is needed.
 */
async function rasterizeSubtreeToPdfViaPrintEngine(
  node: SceneNode,
  doc: SceneDocument,
  scale: number,
  eng: Engine,
  tauri: TauriBridge,
): Promise<Uint8Array> {
  const { blob } = await exportNodeAsRaster(node, doc, eng, { format: 'image/png', scale });
  const dataUrl = await blobToDataUrl(blob);

  const bbox = worldBBox(node, doc);
  const w = Math.max(1, Math.ceil(bbox.w * scale));
  const h = Math.max(1, Math.ceil(bbox.h * scale));

  const replacement: ShapeNode = {
    id: node.id,
    kind: 'shape',
    name: node.name,
    layerColor: null,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fills: [imageFill(dataUrl, { fit: 'fill', opacity: 1, blendMode: 'normal', visible: true })],
    strokes: [],
    effects: [],
    shape: { kind: 'rect', x: 0, y: 0, w, h },
  };
  const replacementDoc: SceneDocument = {
    ...doc,
    rootChildren: [replacement.id],
    nodes: { [replacement.id]: replacement },
  };

  const subtree = flattenSceneToEngine(replacementDoc, [replacement.id]);
  const opts = {
    pageWidth: w,
    pageHeight: h,
    title: node.name,
    author: 'Varve',
    outlineText: false,
    subsetFonts: false,
    fonts: [] as Array<[string, number[]]>,
  };
  // Without an image manifest the print pipeline substitutes a 16×16
  // checkerboard for the rasterized content — the whole PDF page would be a
  // placeholder. Ship the decoded pixels alongside the nodes.
  const manifestJson = await buildPrintImageManifestFromPngBlob(blob, dataUrl);
  const bytes = (await tauri.core.invoke('export_node_pdf', {
    nodes: subtree.nodes,
    opts,
    manifestJson: manifestJson ?? null,
  })) as number[];
  return new Uint8Array(bytes);
}

function maybeDisclosePdf(
  bytes: Uint8Array,
  doc: SceneDocument,
  nodeId: string,
  includeAiDisclosure?: boolean,
): Uint8Array {
  if (includeAiDisclosure === false) return bytes;
  const disclosure = getDocumentAiDisclosure(doc, [nodeId]);
  if (!disclosure) return bytes;
  return insertPdfXmp(bytes, generateAiDisclosureXmp(disclosure));
}

export async function exportNodeAsPdf(
  node: SceneNode,
  doc: SceneDocument,
  scale: number,
  eng?: Engine,
  options: { includeAiDisclosure?: boolean } = {},
): Promise<{ bytes: Uint8Array; filename: string }> {
  ({ node, document: doc } = prepareArtworkExport(node, doc));
  const subtree = flattenSceneToEngine(doc, [node.id]);
  assertPdfPatternSources(subtree.nodes, 'PDF');
  // ── Decision: vector vs raster path ──────────────────────────────────
  // The Rust print engine (strata-print) handles solid fills, strokes,
  // and basic shapes natively. Everything else falls back to a rasterized
  // PNG-in-PDF produced by the live canvas renderer, which handles the
  // full filter/adjustment/compositing pipeline.
  //
  // The compositor's capability assessment identifies which nodes the Rust
  // engine cannot represent (effects, text, non-linear gradients, masks,
  // adjustments, rotation/skew) and returns the boundaries that need
  // pre-rasterization.
  const needsRaster = await subtreeRequiresRasterPdfFallback(node, doc);
  const filename = buildFilename(node.name, 'pdf');
  const tauri = getTauriBridge();

  // Browsers do not have the native vector PDF command. Use the same rendered
  // subtree as preview and embed it in the local PDF fallback for every node,
  // including simple shapes that the desktop path can preserve as vectors.
  if (!tauri) {
    const engine = eng ?? (await createEngine('stub'));
    const result = await rasterizeSubtreeToPdf(node, doc, scale, engine);
    return {
      bytes: maybeDisclosePdf(result.bytes, doc, node.id, options.includeAiDisclosure),
      filename,
    };
  }

  if (needsRaster) {
    const engine = eng ?? (await createEngine('stub'));
    const bytes = await rasterizeSubtreeToPdfViaPrintEngine(node, doc, scale, engine, tauri);
    return { bytes: maybeDisclosePdf(bytes, doc, node.id, options.includeAiDisclosure), filename };
  }

  // ── Vector path (pure solid-fill shapes, no effects) ─────────────────
  const fontRequests = collectEngineFonts(subtree.nodes);
  await awaitExportsReady(fontRequests);

  // Collect font binary data for native PDF text/embedding
  const fontDataRequests = collectExportFontRequests(fontRequests).map(
    ({ family, fontReference }) => ({
      family,
      ...(fontReference ? { fontReference } : {}),
    }),
  );
  const fontRecords = await collectFontData(fontDataRequests, {
    fetchBundled: true,
    failOnTimeout: true,
    signal: undefined,
  });
  assertExportFontData(fontRequests, fontRecords);
  const fontDataForIpc: Array<[string, number[]]> = fontRecords.map((r) => [
    r.family,
    Array.from(r.data),
  ]);

  const bbox = worldBBox(node, doc);
  if (scale !== 1) {
    throw new Error(
      'PDF vector output supports 1x document units only. Use 1x or export PNG/JPEG/WebP for scaled raster output.',
    );
  }
  const w = Math.max(Math.ceil(bbox.w), 1);
  const h = Math.max(Math.ceil(bbox.h), 1);

  const nodes = subtree.nodes.map((sceneNode) => ({
    ...sceneNode,
    transform: [
      1,
      0,
      0,
      1,
      sceneNode.transform[4] - bbox.x,
      sceneNode.transform[5] - bbox.y,
    ] as const,
  }));
  const opts: Record<string, unknown> = {
    pageWidth: w,
    pageHeight: h,
    title: node.name,
    author: 'Varve',
    outlineText: false,
    subsetFonts: fontDataForIpc.length > 0,
    fonts: fontDataForIpc,
  };
  const manifestJson = await buildPrintImageManifestForSrcs(collectImageFillSrcs(nodes));
  const bytes = (await tauri.core.invoke('export_node_pdf', {
    nodes,
    opts,
    manifestJson: manifestJson ?? null,
  })) as number[];
  return {
    bytes: maybeDisclosePdf(new Uint8Array(bytes), doc, node.id, options.includeAiDisclosure),
    filename,
  };
}

/** Press-ready PDF/X standards backed by the native print pipeline. */
export type PdfXStandard = 'pdf-x1a' | 'pdf-x4';

export interface PdfXExportOptions {
  /** Bleed in millimetres added around the trim box. */
  bleedMm?: number;
  includeCropMarks?: boolean;
  includeRegistrationMarks?: boolean;
  colorBars?: boolean;
  /** Minimum effective image resolution the preflight enforces. */
  enforceDpi?: number;
  /** Destination ICC profile name (PDF/X-1a converts to this CMYK space). */
  iccProfile?: string;
  /** Convert text to outlines instead of embedding/subsetting fonts. */
  outlineText?: boolean;
  /** Include AI disclosure metadata when the document has generative edits. Defaults to true. */
  includeAiDisclosure?: boolean;
}

/**
 * Export a node as a press-ready PDF/X file via the native print pipeline
 * (`strata_print::cmyk::export_pdfx1a` / `export_pdfx4`).
 *
 * Desktop-only by design: the browser build has no CMYK/ICC print engine, and
 * the `@varve/print` stub emits a placeholder rather than a real PDF — so this
 * throws on web instead of silently producing an invalid press file. The
 * capability contract (`FORMAT_CAPABILITIES['pdf-x1a'].browser === false`)
 * is the single source of truth the UI gates on.
 */
export async function exportNodeAsPdfX(
  node: SceneNode,
  doc: SceneDocument,
  standard: PdfXStandard,
  options: PdfXExportOptions = {},
): Promise<{ bytes: Uint8Array; filename: string }> {
  ({ node, document: doc } = prepareArtworkExport(node, doc));
  // Press export must never silently drop a mockup: the PDF/X route feeds
  // `flattenSceneToEngine` straight to the Rust print pipeline, which never
  // runs the mockup decoration the canvas and raster/SVG/PDF routes share.
  // Blocking with an actionable path is the honest boundary until the press
  // pipeline gains a decoration host.
  if (subtreeNeedsDecoration(doc, [node.id])) {
    throw new Error(
      'PDF/X press export cannot compose mockup frames yet — the press pipeline does not run the mockup compositor, and exporting only the frame background would be wrong. Present the mockup with PNG or PDF export, or flatten it first (Inspector → Mockup → Flatten to image) and export that image to PDF/X.',
    );
  }
  const capability = capabilitiesForFormat(standard, 'tauri');
  const tauri = getTauriBridge();
  if (!tauri) {
    throw new Error(`${capability.label} export requires the desktop app (native print pipeline)`);
  }

  const subtree = flattenSceneToEngine(doc, [node.id]);
  assertPdfPatternSources(subtree.nodes, standard === 'pdf-x1a' ? 'PDF/X-1a' : 'PDF/X-4');
  const fontRequests = collectEngineFonts(subtree.nodes);
  await awaitExportsReady(fontRequests);

  const fontDataRequests = collectExportFontRequests(fontRequests).map(
    ({ family, fontReference }) => ({
      family,
      ...(fontReference ? { fontReference } : {}),
    }),
  );
  const fontRecords = await collectFontData(fontDataRequests, {
    fetchBundled: true,
    failOnTimeout: true,
    signal: undefined,
  });
  assertExportFontData(fontRequests, fontRecords);
  const fonts: Array<[string, number[]]> = fontRecords.map((r) => [r.family, Array.from(r.data)]);

  // Press output embeds real image pixels: without a manifest the Rust print
  // pipeline renders a checkerboard placeholder for every image fill.
  const manifestJson = await buildPrintImageManifestForSrcs(collectImageFillSrcs(subtree.nodes));

  // Press output is 1x document units; scaling belongs to raster formats.
  const bbox = worldBBox(node, doc);
  const w = Math.max(Math.ceil(bbox.w), 1);
  const h = Math.max(Math.ceil(bbox.h), 1);
  const nodes = subtree.nodes.map((sceneNode) => ({
    ...sceneNode,
    transform: [
      1,
      0,
      0,
      1,
      sceneNode.transform[4] - bbox.x,
      sceneNode.transform[5] - bbox.y,
    ] as const,
  }));

  // PdfXOptions in apps/desktop/src-tauri/src/lib.rs is
  // #[serde(default, rename_all = "camelCase")] — keys must be camelCase.
  const optionsJson = JSON.stringify({
    pageWidth: w,
    pageHeight: h,
    title: node.name,
    author: 'Varve',
    bleedMm: options.bleedMm ?? 3,
    includeCropMarks: options.includeCropMarks ?? true,
    includeRegistrationMarks: options.includeRegistrationMarks ?? standard === 'pdf-x1a',
    enforceDpi: options.enforceDpi ?? 300,
    outlineText: options.outlineText ?? false,
    iccProfile: options.iccProfile ?? 'Fogra39',
    colorBars: options.colorBars ?? standard === 'pdf-x1a',
    format: standard,
    fonts,
    subsetFonts: fonts.length > 0,
  });

  const command = standard === 'pdf-x1a' ? 'export_pdfx1a' : 'export_pdfx4';
  const bytes = (await tauri.core.invoke(command, {
    nodesJson: JSON.stringify(nodes),
    pageHeight: h,
    optionsJson,
    manifestJson: manifestJson ?? null,
  })) as number[];

  return {
    bytes: maybeDisclosePdf(new Uint8Array(bytes), doc, node.id, options.includeAiDisclosure),
    filename: buildFilename(node.name, 'pdf'),
  };
}

function assertPdfPatternSources(
  nodes: Parameters<typeof countPatternFillsWithoutTileSource>[0],
  format: 'PDF' | 'PDF/X-1a' | 'PDF/X-4',
): void {
  const count = countPatternFillsWithoutTileSource(nodes);
  if (count === 0) return;
  const fillLabel = count === 1 ? 'pattern fill has' : 'pattern fills have';
  throw new Error(
    `${format} export stopped: ${count} visible ${fillLabel} no tile source. Replace or reimport the missing pattern tile, then export again.`,
  );
}
