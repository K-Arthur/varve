/**
 * Asset export utilities — raster (PNG/JPG/WebP) via offscreen canvas and SVG
 * via codegen. All exports are local: no network round-trips.
 */

import { exportNodeToSvg } from '@strata/codegen';
import type { Engine, SceneNode as EngineNode, RenderItem } from '@strata/engine';
import {
  awaitExportsReady,
  createRasterSurface,
  DEFAULT_RASTER_SURFACE_POLICY,
  type ExportFontRequest,
  encodeRasterSurface,
  fitRasterDimensions,
  getImageCache,
  primitiveBounds,
} from '@strata/engine';
import type { Document as SceneDocument, SceneNode } from '@strata/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY, transformRect } from '@strata/shared';
import { appearancePaddingWorld, expandRect } from '../../canvas/visualBounds';
import { replayStructuredScene } from '../../render/replayScene';
import { flattenSceneToEngine } from '../../render/sceneToEngine';
import { worldBBox } from './measurement';

export type RasterFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ExportOptions {
  format: RasterFormat;
  scale: number;
  quality?: number;
}

export interface RasterExportResult {
  blob: Blob;
  warnings: string[];
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

async function preloadEngineImages(nodes: readonly EngineNode[]): Promise<void> {
  const sources = new Set<string>();
  for (const current of nodes) {
    for (const fill of current.fills ?? []) {
      if (fill.visible === false) continue;
      if (fill.type === 'image' && fill.image?.src) sources.add(fill.image.src);
      if (fill.type === 'pattern' && fill.pattern?.tileSrc) sources.add(fill.pattern.tileSrc);
    }
    if (current.alphaMask) sources.add(current.alphaMask);
  }
  await Promise.all([...sources].map((source) => getImageCache().load(source)));
}

function colorHasAlpha(color: { a: number } | undefined): boolean {
  return color !== undefined && color.a < 255;
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

function assertRasterStructuralSupport(node: SceneNode, doc: SceneDocument): void {
  const stack: SceneNode[] = [doc.nodes[node.id] ?? node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.kind === 'group' && current.effects.some((effect) => effect.visible)) {
      throw new Error(
        `Raster export cannot yet preserve effects applied to group "${current.name}". Apply the effect to its children, or export SVG until shared group-surface effects are implemented.`,
      );
    }
    if ('children' in current) {
      for (const childId of current.children) {
        const child = doc.nodes[childId];
        if (child) stack.push(child);
      }
    }
  }
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
  assertRasterStructuralSupport(node, doc);
  // Guard against exporting mid-font-swap: a font requested via fontFamily
  // may still be loading (bundled FontFace fetch, Google Fonts injection, or
  // a race right after the user picks a new typeface). Without this, text
  // silently renders with the fallback font and the export looks correct at
  // a glance but is wrong — deterministic export requires settled fonts.
  await awaitExportsReady(collectEngineFonts(flattened.nodes));
  await preloadEngineImages(flattened.nodes);

  const warnings: string[] = [];

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

  const surface = createRasterSurface(w, h, { alpha: opts.format !== 'image/jpeg' });
  const ctx = surface.context;

  ctx.scale(scale, scale);
  ctx.translate(-bbox.x, -bbox.y);

  replayStructuredScene(ctx, {
    document: doc,
    rootIds: [node.id],
    flattenedIds: flattened.ids,
    items: ir,
  });

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

  return { blob, warnings };
}

export async function exportNodeAsSvg(node: SceneNode, doc: SceneDocument): Promise<Blob> {
  const svg = exportNodeToSvg(node, doc);
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
 * Check if any node in the subtree rooted at `node` has an active raster mask.
 */
function subtreeHasRasterMask(node: SceneNode, doc: SceneDocument): boolean {
  if ('mask' in node && node.mask?.visible === true && 'rasterMask' in node.mask) {
    return true;
  }
  if ('children' in node) {
    for (const childId of node.children) {
      const child = doc.nodes[childId];
      if (child && subtreeHasRasterMask(child, doc)) return true;
    }
  }
  return false;
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
    rgb[off] = rgbaPixels[off];
    rgb[off + 1] = rgbaPixels[off + 1];
    rgb[off + 2] = rgbaPixels[off + 2];
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

export async function exportNodeAsPdf(
  node: SceneNode,
  doc: SceneDocument,
  scale: number,
): Promise<{ bytes: Uint8Array; filename: string }> {
  // ── Raster mask detection: fall back to rasterized PNG-in-PDF ─────
  // The Rust print engine does not yet support alpha masks via PDF SMask.
  // When a raster mask is present, render the subtree via canvas at 1x
  // and embed the result as a flat RGB image in a minimal PDF wrapper.
  if (subtreeHasRasterMask(node, doc)) {
    const rasterResult = await exportNodeAsRaster(
      node,
      doc,
      {
        buildIr: async () => [],
      } as unknown as Engine,
      {
        format: 'image/png',
        scale,
      },
    );
    const blob = rasterResult.blob;

    // Decode PNG to RGBA pixels for embedding as RGB in PDF
    const img = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    img.close();

    const pdfBytes = makeSimpleImagePdf(imageData.data, img.width, img.height);
    const filename = buildFilename(node.name, 'pdf');
    return { bytes: pdfBytes, filename };
  }

  const subtree = flattenSceneToEngine(doc, [node.id]);
  // Same font-readiness guard as raster export: worldBBox measures text via
  // canvas metrics that depend on the requested font actually being loaded.
  await awaitExportsReady(collectEngineFonts(subtree.nodes));

  const bbox = worldBBox(node, doc);
  if (scale !== 1) {
    throw new Error(
      'PDF is vector output and currently supports 1x document units only. Choose 1x, or export PNG/JPEG/WebP for scaled raster output.',
    );
  }
  const w = Math.max(Math.ceil(bbox.w), 1);
  const h = Math.max(Math.ceil(bbox.h), 1);

  // Validate the structural scene before flattening. Groups are not raster
  // primitives, so leaf-only checks would silently lose group compositing.
  const structuralStack: SceneNode[] = [doc.nodes[node.id] ?? node];
  while (structuralStack.length > 0) {
    const current = structuralStack.pop()!;
    if (current.kind === 'group') {
      const unsupportedGroupCompositing =
        (current.opacity ?? 1) < 1 ||
        (current.blendMode !== undefined &&
          current.blendMode !== 'normal' &&
          current.blendMode !== 'passThrough') ||
        current.isolated === true ||
        current.effects.some((effect) => effect.visible) ||
        current.mask?.visible === true;
      if (unsupportedGroupCompositing) {
        throw new Error(
          `PDF export cannot yet preserve group opacity, blends, isolation, effects, or masks on "${current.name}". Export PNG for exact Canvas 2D appearance.`,
        );
      }
    } else if ('mask' in current && current.mask?.visible === true) {
      // Should not reach here — raster mask case handled above, but keep
      // the guard for other mask types (clip, vector, sourceNodeId).
      throw new Error(
        `PDF export cannot yet preserve the mask on "${current.name}". Export PNG for exact Canvas 2D appearance.`,
      );
    }
    if ('children' in current) {
      for (const childId of current.children) {
        const child = doc.nodes[childId];
        if (child) structuralStack.push(child);
      }
    }
  }

  for (const sceneNode of subtree.nodes) {
    const [a, b, c, d] = sceneNode.transform;
    if (a !== 1 || b !== 0 || c !== 0 || d !== 1) {
      throw new Error(
        `PDF export cannot yet preserve rotated, skewed, or scaled node "${sceneNode.name}". Export PNG for exact Canvas 2D appearance.`,
      );
    }
    const unsupportedFillSemantics =
      colorHasAlpha(sceneNode.fill) ||
      (sceneNode.fills?.some(
        (fill) =>
          fill.visible &&
          (fill.type !== 'solid' ||
            fill.opacity < 1 ||
            fill.blendMode !== 'normal' ||
            colorHasAlpha(fill.color)),
      ) ??
        false);
    const unsupportedStrokeSemantics =
      sceneNode.strokes?.some((stroke) => stroke.visible && colorHasAlpha(stroke.color)) ?? false;
    if (sceneNode.kind === 'text') {
      throw new Error(
        `Native PDF text outlining is not wired for "${sceneNode.name}"; exporting it would replace the text with a rectangle. Use SVG to preserve editable text, or PNG for exact Canvas 2D appearance.`,
      );
    }
    if (
      (sceneNode.opacity ?? 1) < 1 ||
      (sceneNode.blendMode && sceneNode.blendMode !== 'normal') ||
      (sceneNode.effects?.some((effect) => effect.visible) ?? false) ||
      (sceneNode.filters?.length ?? 0) > 0 ||
      unsupportedFillSemantics ||
      unsupportedStrokeSemantics
    ) {
      throw new Error(
        `PDF export cannot yet preserve transparency, blends, effects, filters, gradients, images, or patterns on "${sceneNode.name}". Export PNG for exact Canvas 2D appearance.`,
      );
    }
  }
  const stack: SceneNode[] = [doc.nodes[node.id] ?? node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.kind === 'frame' && current.clipContent !== false && current.children.length > 0) {
      throw new Error(
        `PDF export cannot yet preserve clipped descendants in frame "${current.name}". Export PNG for exact Canvas 2D appearance.`,
      );
    }
    if ('children' in current) {
      for (const childId of current.children) {
        const child = doc.nodes[childId];
        if (child) stack.push(child);
      }
    }
  }
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
  const opts = { page_width: w, page_height: h, title: node.name, author: 'Strata' };
  const tauri = (window as unknown as Record<string, unknown>).__TAURI__ as
    | { core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }
    | undefined;

  if (!tauri) {
    throw new Error('PDF export requires the desktop app');
  }

  const bytes = (await tauri.core.invoke('export_node_pdf', { nodes, opts })) as number[];
  const filename = buildFilename(node.name, 'pdf');
  return { bytes: new Uint8Array(bytes), filename };
}
