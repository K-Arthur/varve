/**
 * Asset export utilities — raster (PNG/JPG/WebP) via offscreen canvas and SVG
 * via codegen. All exports are local: no network round-trips.
 */

import { exportNodeToSvg } from '@varve/codegen';
import {
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
  fitRasterDimensions,
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
import { imageFill } from '@varve/scene';
import type { MetadataPolicy } from '@varve/scene/export';
import { capabilitiesForFormat } from '@varve/scene/export';
import { DEFAULT_ARTWORK_FONT_FAMILY, transformRect } from '@varve/shared';
import { appearancePaddingWorld, expandRect } from '../../canvas/visualBounds';
import {
  composeFlattenedRasterAssetsForNode,
  findFlattenBoundaries,
} from '../../export/compositor';
import { failureWarning, settleEngineImageResources } from '../../export/resourceReadiness';
import { replayStructuredScene } from '../../render/replayScene';
import { flattenSceneToEngine } from '../../render/sceneToEngine';
import { worldBBox } from './measurement';

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
    requests.push({ family, weight, style, text: current.text ?? '' });
    for (const paragraph of current.richText?.paragraphs ?? []) {
      for (const run of paragraph.runs) {
        requests.push({
          family: run.format?.fontFamily ?? family,
          weight: run.format?.fontWeight ?? weight,
          style: run.format?.fontStyle === 'italic' ? 'italic' : style,
          text: run.text,
        });
      }
    }
  }
  return requests;
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

/** Bounds of every pixel the resolved render IR may emit. */
function exportWorldBounds(
  node: SceneNode,
  doc: SceneDocument,
  flattenedIds: readonly string[],
  items: readonly RenderItem[],
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let bounds: { x: number; y: number; w: number; h: number } | null = null;
  for (const item of items) {
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

export async function exportNodeAsRaster(
  node: SceneNode,
  doc: SceneDocument,
  eng: Engine,
  opts: ExportOptions,
): Promise<RasterExportResult> {
  // Resolve variants, bindings, reusable styles, and world transforms before
  // resource readiness. Waiting on the raw model can load a stale font/image
  // while the resolved render node uses a different resource.
  const flattened = flattenSceneToEngine(doc, [node.id]);
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

  const ir = await eng.buildIr({ nodes: flattened.nodes });
  const bbox = exportWorldBounds(node, doc, flattened.ids, ir);

  let scale = opts.scale;
  const requestedW = Math.max(Math.ceil(bbox.w * scale), 1);
  const requestedH = Math.max(Math.ceil(bbox.h * scale), 1);
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
  const surface = createRasterSurface(w, h, { alpha: transparent });
  const ctx = surface.context;

  if (!transparent && opts.matteColor) {
    const [r, g, b, a] = opts.matteColor;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.scale(scale, scale);
  ctx.translate(-bbox.x, -bbox.y);

  replayStructuredScene(ctx, {
    document: doc,
    rootIds: [node.id],
    flattenedIds: flattened.ids,
    items: ir,
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

  return { blob, warnings, resourceFailures };
}

export async function exportNodeAsSvg(
  node: SceneNode,
  doc: SceneDocument,
  eng?: Engine,
): Promise<Blob> {
  const rasterAssets = await composeFlattenedRasterAssetsForNode(node, doc, 'svg', {
    scale: 1,
    engine: eng,
  });
  const svg = exportNodeToSvg(node, doc, { rasterAssets });
  return new Blob([svg], { type: 'image/svg+xml' });
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

export function buildFilename(nodeName: string, ext: string): string {
  const safe = nodeName.replace(/[^a-zA-Z0-9-_\s]/g, '').trim() || 'export';
  return `${safe}.${ext}`;
}

/**
 * Generate a minimal 1-page PDF with an embedded RGB image.
 * Standard PDF structure: header, objects, cross-reference table, trailer.
 */
function makeSimpleImagePdf(rgbaPixels: Uint8Array, width: number, height: number): Uint8Array {
  // Strip alpha → RGB for the PDF image XObject
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    rgb[off] = rgbaPixels[off]!;
    rgb[off + 1] = rgbaPixels[off + 1]!;
    rgb[off + 2] = rgbaPixels[off + 2]!;
  }

  const streamData = rgb;
  const streamLen = streamData.length;

  // Object numbers
  const CATALOG = 1;
  const PAGES = 2;
  const PAGE = 3;
  const STREAM = 4;
  const XREF = 5;

  const sb: string[] = [];
  const push = (s: string) => sb.push(s);
  const emitObj = (num: number, body: string) => {
    push(`${num} 0 obj`);
    push(body);
    push('endobj');
  };

  push('%PDF-1.4');

  // Catalog
  emitObj(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R >>`);
  // Pages
  emitObj(PAGES, `<< /Type /Pages /Kids [ ${PAGE} 0 R ] /Count 1 >>`);
  // Page with image
  const pageContent = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ`;
  emitObj(
    PAGE,
    `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [ 0 0 ${width} ${height} ] /Contents ${STREAM + 1} 0 R /Resources << /XObject << /Im0 ${STREAM} 0 R >> >> >>`,
  );
  // Image XObject stream
  emitObj(
    STREAM,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${streamLen} >>\nstream\n<NOT_ESCAPED>\nendstream`,
  );
  // Content stream
  emitObj(STREAM + 1, `<< /Length ${pageContent.length} >>\nstream\n${pageContent}\nendstream`);

  const body = sb.join('\n');
  const bodyBytes = new TextEncoder().encode(body);

  // Build the final bytes: body then xref then trailer
  const xrefOffset = bodyBytes.length + 1; // +1 for newline
  const xref = `xref\n0 ${XREF + 1}\n0000000000 65535 f \n${'0'.repeat(10)} 00000 n \n${'0'.repeat(10)} 00000 n \n${'0'.repeat(10)} 00000 n \n${'0'.repeat(10)} 00000 n \n${'0'.repeat(10)} 00000 n \ntrailer\n<< /Size ${XREF + 1} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const xrefBytes = new TextEncoder().encode(xref);

  // Now construct the actual file with stream data inserted
  const result = new Uint8Array(bodyBytes.length + streamLen + xrefBytes.length + 64);
  let pos = 0;

  // Write body up to the placeholder marker
  const bodyStr = body;
  const marker = '<NOT_ESCAPED>';
  const markerIdx = bodyStr.indexOf(marker);
  // Write everything before the marker
  const beforeMarker = new TextEncoder().encode(bodyStr.slice(0, markerIdx));
  result.set(beforeMarker, pos);
  pos += beforeMarker.length;
  // Write the stream data
  result.set(streamData, pos);
  pos += streamData.length;
  // Write everything after the marker
  const afterMarker = new TextEncoder().encode(bodyStr.slice(markerIdx + marker.length));
  result.set(afterMarker, pos);
  pos += afterMarker.length;
  // Write xref/trailer
  result.set(xrefBytes, pos);
  pos += xrefBytes.length;

  return result.slice(0, pos);
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
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  img.close();

  const pdfBytes = makeSimpleImagePdf(
    imageData.data as unknown as Uint8Array,
    img.width,
    img.height,
  );
  return { bytes: pdfBytes, pixelWidth: img.width, pixelHeight: img.height };
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
  const bytes = (await tauri.core.invoke('export_node_pdf', {
    nodes: subtree.nodes,
    opts,
  })) as number[];
  return new Uint8Array(bytes);
}

export async function exportNodeAsPdf(
  node: SceneNode,
  doc: SceneDocument,
  scale: number,
  eng?: Engine,
): Promise<{ bytes: Uint8Array; filename: string }> {
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
    return { bytes: result.bytes, filename };
  }

  if (needsRaster) {
    const engine = eng ?? (await createEngine('stub'));
    const bytes = await rasterizeSubtreeToPdfViaPrintEngine(node, doc, scale, engine, tauri);
    return { bytes, filename };
  }

  // ── Vector path (pure solid-fill shapes, no effects) ─────────────────
  const subtree = flattenSceneToEngine(doc, [node.id]);
  const fontRequests = collectEngineFonts(subtree.nodes);
  await awaitExportsReady(fontRequests);

  // Collect font binary data for native PDF text/embedding
  const fontFamilies = [...new Set(fontRequests.map((f) => f.family))];
  const fontRecords = await collectFontData(fontFamilies, {
    fetchBundled: true,
    signal: undefined,
  });
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
  const bytes = (await tauri.core.invoke('export_node_pdf', { nodes, opts })) as number[];
  return { bytes: new Uint8Array(bytes), filename };
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
  const capability = capabilitiesForFormat(standard, 'tauri');
  const tauri = getTauriBridge();
  if (!tauri) {
    throw new Error(`${capability.label} export requires the desktop app (native print pipeline)`);
  }

  const subtree = flattenSceneToEngine(doc, [node.id]);
  const fontRequests = collectEngineFonts(subtree.nodes);
  await awaitExportsReady(fontRequests);

  const fontFamilies = [...new Set(fontRequests.map((f) => f.family))];
  const fontRecords = await collectFontData(fontFamilies, {
    fetchBundled: true,
    signal: undefined,
  });
  const fonts: Array<[string, number[]]> = fontRecords.map((r) => [r.family, Array.from(r.data)]);

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
    nodes_json: JSON.stringify(nodes),
    page_height: h,
    options_json: optionsJson,
    manifest_json: null,
  })) as number[];

  return { bytes: new Uint8Array(bytes), filename: buildFilename(node.name, 'pdf') };
}
