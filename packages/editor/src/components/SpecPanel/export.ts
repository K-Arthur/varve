/**
 * Asset export utilities — raster (PNG/JPG/WebP) via offscreen canvas and SVG
 * via codegen. All exports are local: no network round-trips.
 */

import type { Engine } from '@strata/engine';
import { replayIr } from '@strata/engine';
import type { Document as SceneDocument, SceneNode } from '@strata/scene';
import { exportNodeToSvg } from '@strata/codegen';
import { worldBBox } from './measurement';

export type RasterFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ExportOptions {
  format: RasterFormat;
  scale: number;
  quality?: number;
}

function toEngineNode(n: SceneNode) {
  const base = {
    id: n.id,
    name: n.name,
    fill: n.fill,
    transform: n.transform,
    opacity: (n as any).opacity ?? 1,
    blendMode: (n as any).blendMode ?? ('normal' as const),
    rotation: (n as any).rotation ?? 0,
    strokes: 'strokes' in n ? (n.strokes ?? []) : [],
    effects: 'effects' in n ? (n.effects ?? []) : [],
  };
  if (n.kind === 'shape') return { ...base, shape: n.shape };
  if (n.kind === 'text')
    return {
      ...base,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: (n.fontSize ?? 16) * 3, h: (n.fontSize ?? 16) * 1.4 },
    };
  return { ...base, shape: { kind: 'rect' as const, x: 0, y: 0, w: 200, h: 160 } };
}

export async function exportNodeAsRaster(
  node: SceneNode,
  doc: SceneDocument,
  eng: Engine,
  opts: ExportOptions,
): Promise<Blob> {
  const bbox = worldBBox(node, doc);
  const w = Math.max(Math.round(bbox.w * opts.scale), 1);
  const h = Math.max(Math.round(bbox.h * opts.scale), 1);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get offscreen canvas context');

  ctx.scale(opts.scale, opts.scale);
  ctx.translate(-bbox.x, -bbox.y);

  const ir = await eng.buildIr({
    nodes: [toEngineNode(node)],
  });
  replayIr(ctx as unknown as import('@strata/engine').ReplayTarget, ir);

  const blob = await canvas.convertToBlob({
    type: opts.format,
    quality: opts.quality ?? (opts.format === 'image/jpeg' ? 0.92 : undefined),
  });
  return blob;
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
