/**
 * Canonical thumbnail identity builder — maps (document, source, variant)
 * to the deterministic cache key defined by @varve/shared.
 *
 * The docKey is the stable FILE identity when one exists; a bare node/page
 * id is never usable as a key component because ids are per-document
 * sequential counters that collide across documents.
 */

import { THUMBNAIL_RENDERER_VERSION } from '@varve/engine';
import { contentHash } from '@varve/platform';
import { type Document, DocumentCodec } from '@varve/scene';
import {
  computeThumbnailIdentity,
  type ThumbnailIdentity,
  type ThumbnailSourceSpec,
  type ThumbnailVariant,
} from '@varve/shared';

export interface ThumbnailIdentityOptions {
  /** Stable file identity (FileEntry.id). When absent, the revision is the docKey. */
  fileId?: string;
  doc: Document;
  source: ThumbnailSourceSpec;
  variant: ThumbnailVariant;
}

/**
 * Serialize a document to the canonical revision string. MUST match what
 * the platform persists as `FileEntry.contentHash` (the editor's
 * `DocumentCodec.encode` output hashed with `contentHash`) — the Home
 * loader derives its identity from the persisted `contentHash`, so a
 * different serialization here would produce a different cache key and
 * every thumbnail would miss on Home.
 */
export function documentRevisionHash(doc: Document): string {
  try {
    return contentHash(DocumentCodec.encode(doc));
  } catch {
    return contentHash(JSON.stringify(doc));
  }
}

export function thumbnailIdentity(opts: ThumbnailIdentityOptions): ThumbnailIdentity {
  const revisionHash = documentRevisionHash(opts.doc);
  return computeThumbnailIdentity({
    docKey: opts.fileId ?? revisionHash,
    revisionHash,
    source: opts.source,
    variant: opts.variant,
    rendererVersion: THUMBNAIL_RENDERER_VERSION,
  });
}

/** Identity for a page thumbnail (page nav / pages panel variants). */
export function pageThumbnailIdentity(
  doc: Document,
  pageId: string,
  variant: ThumbnailVariant,
  fileId?: string,
): ThumbnailIdentity {
  return thumbnailIdentity({ fileId, doc, source: { type: 'page', pageId }, variant });
}

/**
 * Legacy cache key (bare content hash) for warm migration: reads thumbnails
 * written by the pre-canonical system so existing files keep their previews
 * until the next save regenerates them canonically.
 */
export function legacyThumbnailKey(doc: Document): string {
  return documentRevisionHash(doc);
}
