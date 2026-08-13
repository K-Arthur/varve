/**
 * Canonical document thumbnail service — one generation path for every
 * thumbnail surface (Home cards, page nav, pages panel, version history,
 * picker previews).
 *
 * Pipeline: source resolution (@varve/scene) → canonical scene-to-engine
 * conversion (`flattenSceneToEngine`, the same module the canvas uses) →
 * engine IR replay → encoded data URL.
 *
 * Fidelity rules:
 *  - renders through the canonical conversion, so masks, clips, opacity,
 *    blend modes, gradients, effects, adjustments, image fills, tables and
 *    text all render as they do on canvas (tables and raster-mask proxies
 *    are handled by the conversion's own options);
 *  - waits for fonts within a bounded deadline and marks results
 *    provisional when raster sources were not ready, so a broken thumbnail
 *    is never stored as authoritative;
 *  - a missing source (deleted page/frame) degrades to the automatic
 *    source; callers are told via `fallbackApplied` so UI can surface it.
 */

import { generateThumbnail, THUMBNAIL_RENDERER_VERSION, type ThumbnailResult } from '@varve/engine';
import type { Platform } from '@varve/platform';
import { type Document, resolveThumbnailSource, type ThumbnailSelection } from '@varve/scene';
import type { ThumbnailSourceSpec, ThumbnailVariant } from '@varve/shared';
import { flattenSceneToEngine } from '../render/sceneToEngine';
import { documentRevisionHash, thumbnailIdentity } from './identity';

/** Bound on how long generation waits for fonts before rendering. */
const FONT_WAIT_MS = 500;

/** Maximum number of nodes a single thumbnail render may include. */
const MAX_THUMBNAIL_NODES = 20_000;

export interface RenderDocThumbnailOptions {
  /** Stable file identity (FileEntry.id); participates in the cache key. */
  fileId?: string;
  /** Thumbnail source; defaults to automatic. */
  source?: ThumbnailSourceSpec;
  variant: ThumbnailVariant;
  /** Readiness policy for raster/font sources (defaults: bounded waits). */
  waitForFonts?: boolean;
  /** When true, use the legacy plaintext path even for encrypted docs. */
  allowEncryptedPreview?: boolean;
  signal?: AbortSignal;
}

export interface RenderDocThumbnailOutcome {
  result: ThumbnailResult | null;
  /** The identity the result was rendered under (cache key). */
  identity: ReturnType<typeof thumbnailIdentity>;
  /** Source validity: 'valid' | 'missing-source' | 'empty'. */
  validity: ThumbnailSelection['validity'];
  /** True when the requested source was missing and automatic was used. */
  fallbackApplied: boolean;
  /** The source actually rendered (post-fallback). */
  effectiveSource: ThumbnailSourceSpec;
}

const EMPTY_PLACEHOLDER_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192" viewBox="0 0 256 192">' +
      '<rect width="256" height="192" fill="#f2f2f2" rx="4"/>' +
      '</svg>',
  );

export const EMPTY_DOCUMENT_PLACEHOLDER = EMPTY_PLACEHOLDER_SVG;

/** Only settled thumbnails may become persistent platform records. */
export function shouldPersistThumbnail(result: ThumbnailResult | null): boolean {
  return Boolean(result?.dataUrl && !result.metadata.isProvisional);
}

/**
 * Render (not persist) a document thumbnail through the canonical pipeline.
 * Pure of platform storage; persistence is handled by the store module.
 */
export async function renderDocThumbnail(
  doc: Document,
  options: RenderDocThumbnailOptions,
): Promise<RenderDocThumbnailOutcome> {
  const requested: ThumbnailSourceSpec = options.source ?? { type: 'automatic' };
  let selection = resolveThumbnailSource(doc, requested);
  const fallbackApplied = selection.validity === 'missing-source';
  const effectiveSource: ThumbnailSourceSpec =
    selection.validity === 'missing-source' ? { type: 'automatic' } : requested;

  // Re-resolve after a fallback so the rendered result matches the source
  // recorded in the identity.
  if (fallbackApplied) {
    selection = resolveThumbnailSource(doc, effectiveSource);
  }

  const identity = thumbnailIdentity({
    fileId: options.fileId,
    doc,
    source: effectiveSource,
    variant: options.variant,
  });

  if (options.signal?.aborted) {
    return {
      result: null,
      identity,
      validity: selection.validity,
      fallbackApplied,
      effectiveSource,
    };
  }

  // Empty documents get a proper placeholder instead of transparent pixels.
  if (selection.validity === 'empty' && selection.ids.length === 0) {
    const result: ThumbnailResult = {
      dataUrl: EMPTY_DOCUMENT_PLACEHOLDER,
      metadata: {
        cacheKey: identity.key,
        sourceBounds: null,
        scaleFactor: 1,
        outputWidth: options.variant.width,
        outputHeight: options.variant.height,
        mimeType: 'image/svg+xml',
        byteSize: EMPTY_DOCUMENT_PLACEHOLDER.length,
        generatedAt: Date.now(),
        revisionId: documentRevisionHash(doc),
        rendererVersion: THUMBNAIL_RENDERER_VERSION,
        isPlaceholder: true,
        isProvisional: false,
        warnings: ['empty-document'],
      },
    };
    return { result, identity, validity: selection.validity, fallbackApplied, effectiveSource };
  }

  if (options.waitForFonts !== false) {
    await waitForFonts();
  }
  if (options.signal?.aborted) {
    return {
      result: null,
      identity,
      validity: selection.validity,
      fallbackApplied,
      effectiveSource,
    };
  }

  if (selection.ids.length > MAX_THUMBNAIL_NODES) {
    selection = { ...selection, ids: selection.ids.slice(0, MAX_THUMBNAIL_NODES) };
  }

  const engineNodes = flattenSceneToEngine(doc, selection.ids, {
    // Page previews render in page-local coordinates (page at the origin);
    // all other sources render in pasteboard space like the canvas.
    localTransforms: effectiveSource.type === 'page',
  });
  if (engineNodes.nodes.length === 0) {
    const result: ThumbnailResult = {
      dataUrl: EMPTY_DOCUMENT_PLACEHOLDER,
      metadata: {
        cacheKey: identity.key,
        sourceBounds: null,
        scaleFactor: 1,
        outputWidth: options.variant.width,
        outputHeight: options.variant.height,
        mimeType: 'image/svg+xml',
        byteSize: EMPTY_DOCUMENT_PLACEHOLDER.length,
        generatedAt: Date.now(),
        revisionId: documentRevisionHash(doc),
        rendererVersion: THUMBNAIL_RENDERER_VERSION,
        isPlaceholder: true,
        isProvisional: false,
        warnings: ['no-renderable-nodes'],
      },
    };
    return { result, identity, validity: selection.validity, fallbackApplied, effectiveSource };
  }

  const result = await generateThumbnail(
    engineNodes.nodes,
    documentRevisionHash(doc),
    {
      maxWidth: options.variant.width,
      maxHeight: options.variant.height,
      fit: options.variant.fit,
      background: options.variant.background,
      format: options.variant.format,
      devicePixelRatio: options.variant.devicePixelRatio,
      frame: selection.worldFrame ?? undefined,
      sourceLabel: sourceDisplayLabel(effectiveSource),
    },
    options.signal,
  );

  return { result, identity, validity: selection.validity, fallbackApplied, effectiveSource };
}

function sourceDisplayLabel(source: ThumbnailSourceSpec): string {
  switch (source.type) {
    case 'automatic':
      return 'Automatic';
    case 'page':
      return 'Page';
    case 'frame':
      return 'Frame';
    case 'selection':
      return 'Selection';
    case 'region':
      return 'Design region';
  }
}

/** Wait for web fonts with a bounded deadline; never throws. */
async function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
    ]);
  } catch {
    // Font failures must never block or fail a thumbnail.
  }
}

/**
 * Generate AND persist a thumbnail for a document via the platform store.
 * Non-fatal: returns null on any failure so callers never crash on
 * thumbnails.
 */
export async function persistDocThumbnail(
  platform: Platform,
  doc: Document,
  options: RenderDocThumbnailOptions,
): Promise<RenderDocThumbnailOutcome | null> {
  try {
    const outcome = await renderDocThumbnail(doc, options);
    if (!shouldPersistThumbnail(outcome.result)) return outcome;
    const r = outcome.result;
    await platform.putThumbnail({
      hash: outcome.identity.key,
      dataUrl: r.dataUrl,
      width: r.metadata.outputWidth,
      height: r.metadata.outputHeight,
      createdAt: Date.now(),
    });
    return outcome;
  } catch {
    return null;
  }
}
