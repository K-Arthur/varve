/**
 * Asset export utilities — raster (PNG/JPG/WebP) via offscreen canvas and SVG
 * via codegen. All exports are local: no network round-trips.
 */

import { exportNodeToSvg } from '@strata/codegen';
import type { Engine } from '@strata/engine';
import { awaitExportsReady, getCanvasSizeLimit, getImageCache, replayIr } from '@strata/engine';
import type { Document as SceneDocument, SceneNode } from '@strata/scene';
import { imageShapeSrc, isImageShape } from '@strata/scene';
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

/**
 * Narrowest per-engine canvas dimension cap among Chromium/WebKit/Gecko
 * (WebKit's 16384px). We can't reliably identify the actual rendering engine
 * from script, so raster export clamps to this conservative floor rather than
 * risking a thrown exception or silently corrupted/blank output on an engine
 * with a tighter limit than the one this session happens to be tested on.
 */
const MAX_SAFE_CANVAS_DIMENSION = getCanvasSizeLimit('webkit');

async function preloadNodeImages(node: SceneNode, doc: SceneDocument): Promise<void> {
  const sources: string[] = [];
  const stack: SceneNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.kind === 'shape' && isImageShape(current)) sources.push(imageShapeSrc(current));
    if ('children' in current && current.children) {
      for (const childId of current.children) {
        const child = doc.nodes[childId];
        if (child) stack.push(child);
      }
    }
  }
  await Promise.all([...new Set(sources)].map((source) => getImageCache().load(source)));
}

function toEngineNode(n: SceneNode) {
  const base = {
    id: n.id,
    name: n.name,
    fill: n.fill,
    fills: n.fills ?? [],
    transform: n.transform,
    opacity: n.opacity ?? 1,
    blendMode: n.blendMode ?? ('normal' as const),
    rotation: n.rotation ?? 0,
    strokes: 'strokes' in n ? (n.strokes ?? []) : [],
    effects: 'effects' in n ? (n.effects ?? []) : [],
    alphaMask: 'alphaMask' in n && typeof n.alphaMask === 'string' ? n.alphaMask : undefined,
  };
  if (n.kind === 'shape') return { ...base, shape: n.shape };
  if (n.kind === 'text')
    return {
      ...base,
      kind: 'text',
      text: n.text,
      fontSize: n.fontSize,
      fontFamily: n.fontFamily,
      fontWeight: n.fontWeight,
      fontStyle: n.fontStyle,
      textAlign: n.textAlign,
      letterSpacing: n.letterSpacing,
      lineHeight: n.lineHeight,
      paragraphSpacing: n.paragraphSpacing,
      textCase: n.textCase,
      textDecoration: n.textDecoration,
      textOverflow: n.textOverflow,
      listStyle: n.listStyle,
    };
  return { ...base, shape: { kind: 'rect' as const, x: 0, y: 0, w: 200, h: 160 } };
}

export async function exportNodeAsRaster(
  node: SceneNode,
  doc: SceneDocument,
  eng: Engine,
  opts: ExportOptions,
): Promise<RasterExportResult> {
  // Guard against exporting mid-font-swap: a font requested via fontFamily
  // may still be loading (bundled FontFace fetch, Google Fonts injection, or
  // a race right after the user picks a new typeface). Without this, text
  // silently renders with the fallback font and the export looks correct at
  // a glance but is wrong — deterministic export requires settled fonts.
  await awaitExportsReady();
  await preloadNodeImages(node, doc);

  const bbox = worldBBox(node, doc);
  const warnings: string[] = [];

  let scale = opts.scale;
  let w = Math.max(Math.round(bbox.w * scale), 1);
  let h = Math.max(Math.round(bbox.h * scale), 1);

  const largestDimension = Math.max(w, h);
  if (largestDimension > MAX_SAFE_CANVAS_DIMENSION) {
    scale = opts.scale * (MAX_SAFE_CANVAS_DIMENSION / largestDimension);
    w = Math.max(Math.round(bbox.w * scale), 1);
    h = Math.max(Math.round(bbox.h * scale), 1);
    warnings.push(
      `Requested export size exceeded the ${MAX_SAFE_CANVAS_DIMENSION}px canvas limit; scaled down to ${w}x${h} (effective ${scale.toFixed(3)}x of ${opts.scale}x) to avoid a blank or corrupted export.`,
    );
  }

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get offscreen canvas context');

  ctx.scale(scale, scale);
  ctx.translate(-bbox.x, -bbox.y);

  const ir = await eng.buildIr({
    nodes: [toEngineNode(node)],
  });
  replayIr(ctx as unknown as import('@strata/engine').ReplayTarget, ir);

  let blob: Blob;
  try {
    blob = await canvas.convertToBlob({
      type: opts.format,
      quality: opts.quality ?? (opts.format === 'image/jpeg' ? 0.92 : undefined),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'SecurityError') {
      throw new Error(
        'Export failed: this node includes a cross-origin image that does not permit CORS access, which taints the canvas and blocks pixel export. Re-import the image as a local asset, or ensure the image host sends permissive CORS headers.',
      );
    }
    throw err;
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

export async function exportNodeAsPdf(
  node: SceneNode,
  doc: SceneDocument,
  scale: number,
): Promise<{ bytes: Uint8Array; filename: string }> {
  // Same font-readiness guard as raster export: worldBBox measures text via
  // canvas metrics that depend on the requested font actually being loaded.
  await awaitExportsReady();

  const bbox = worldBBox(node, doc);
  const w = Math.max(Math.round(bbox.w * scale), 1);
  const h = Math.max(Math.round(bbox.h * scale), 1);

  const nodes = [toEngineNode(node)];
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
