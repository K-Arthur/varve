/**
 * Thumbnail source resolution — adapter between the persisted preference
 * model and the canonical pipeline.
 *
 * Source resolution itself lives in `@varve/scene` (`resolveThumbnailSource`,
 * automatic heuristic); document→engine conversion is the canonical
 * `flattenSceneToEngine` (the same module the canvas uses), so thumbnails
 * cannot drift from the render pipeline.
 */

import type { ThumbnailResult } from '@varve/engine';
import { generateThumbnail, THUMBNAIL_RENDERER_VERSION } from '@varve/engine';
import { type Document, resolveThumbnailSource } from '@varve/scene';
import type { ThumbnailSourceSpec } from '@varve/shared';
import { flattenSceneToEngine } from '../render/sceneToEngine';
import { documentRevisionHash } from './identity';

/** @deprecated Use `ThumbnailSourceSpec` from @varve/shared. */
export type ThumbnailSourceType = ThumbnailSourceSpec;

/** @deprecated Use `thumbnailSourceLabel` from @varve/shared. */
export function sourceLabel(s: ThumbnailSourceSpec): string {
  switch (s.type) {
    case 'automatic':
      return 'Automatic';
    case 'page':
      return 'Current page';
    case 'frame':
      return 'Selected frame';
    case 'selection':
      return 'Selection';
    case 'region':
      return 'Design region';
  }
}

/** @deprecated Use `resolveThumbnailSource` from @varve/scene. */
export const resolveThumbnailNodes = resolveThumbnailSource;

export interface GenerateDocThumbnailOptions {
  source?: ThumbnailSourceSpec;
  maxWidth?: number;
  maxHeight?: number;
  fit?: 'contain' | 'cover' | 'fill';
  background?:
    | { type: 'transparent' }
    | { type: 'solid'; color: string }
    | { type: 'checkerboard' }
    | { type: 'match-theme' };
  quality?: number;
  devicePixelRatio?: number;
  format?: 'png' | 'webp';
  sourceLabel?: string;
}

/**
 * Generate a thumbnail for a scene Document through the canonical pipeline:
 * resolve the source (page, frame, selection, automatic), flatten via the
 * canonical scene-to-engine conversion, render via the engine IR service.
 */
export async function generateDocThumbnail(
  doc: Document,
  options: GenerateDocThumbnailOptions = {},
  signal?: AbortSignal,
): Promise<ThumbnailResult | null> {
  const source: ThumbnailSourceSpec = options.source ?? { type: 'automatic' };
  let selection = resolveThumbnailSource(doc, source);
  if (selection.validity === 'missing-source') {
    selection = resolveThumbnailSource(doc, { type: 'automatic' });
  }
  if (selection.validity === 'empty' && selection.ids.length === 0) return null;
  if (signal?.aborted) return null;

  const engineNodes = flattenSceneToEngine(doc, selection.ids);
  if (engineNodes.nodes.length === 0) return null;

  const revision = documentRevisionHash(doc);
  return generateThumbnail(
    engineNodes.nodes,
    revision,
    {
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
      fit: options.fit,
      background: options.background,
      quality: options.quality,
      devicePixelRatio: options.devicePixelRatio,
      format: options.format,
      frame: selection.worldFrame ?? undefined,
      sourceLabel: options.sourceLabel ?? sourceLabel(source),
    },
    signal,
  );
}

export { THUMBNAIL_RENDERER_VERSION };
