import { getFontRegistry } from '@varve/engine';
import {
  attachFontManifestToDocument,
  createFontCatalogFromRegistry,
  type FontCatalog,
} from '@varve/engine/font';
import { type Document, DocumentCodec } from '@varve/scene';

/**
 * Encode a document using only the values supplied by the caller.
 *
 * Keeping the catalog explicit is important: callers can capture an
 * immutable document revision now and perform the expensive manifest walk and
 * codec work later, without this helper reading editor state as a side effect.
 */
export function serializeDocumentSnapshot(document: Document, catalog: FontCatalog): string {
  const { manifest } = attachFontManifestToDocument(
    {
      nodes: document.nodes,
      styles: document.styles,
      fontManifest: document.fontManifest,
    } as Parameters<typeof attachFontManifestToDocument>[0],
    catalog,
  );
  return DocumentCodec.encode({ ...document, fontManifest: manifest });
}

let cachedRegistry: ReturnType<typeof getFontRegistry> | null = null;
let cachedRegistryRevision = '';
let cachedCatalog: FontCatalog | null = null;

/**
 * Font catalog construction is intentionally outside the edit path. The
 * registry exposes a monotone revision, so repeated edits reuse the catalog
 * in O(1) and a font load rebuilds it exactly once for the next persistence
 * operation.
 */
export function getPersistenceFontCatalog(): FontCatalog {
  const registry = getFontRegistry();
  const revision = registry.revision;
  if (cachedCatalog && cachedRegistry === registry && cachedRegistryRevision === revision) {
    return cachedCatalog;
  }
  cachedRegistry = registry;
  cachedRegistryRevision = revision;
  cachedCatalog = createFontCatalogFromRegistry(registry);
  return cachedCatalog;
}

export interface PersistenceRevision {
  /** Unique identity for this immutable revision, not a document schema ID. */
  readonly token: string;
  /** Editor tab/session that owns the revision. */
  readonly sessionId: string;
  /** Storage project key used by versioned backups. */
  readonly projectId: string;
  readonly fileId?: string;
  readonly filePath?: string;
  readonly fileName: string;
  readonly revision: number;
  readonly document: Document;
  readonly capturedAt: number;
  /** Materializes exactly once after a persistence lane admits this revision. */
  readonly materialize: () => string;
}

let nextRevisionToken = 1;

export function createPersistenceRevision(input: {
  sessionId: string;
  projectId: string;
  fileId?: string;
  filePath?: string;
  fileName: string;
  revision: number;
  document: Document;
  capturedAt?: number;
}): PersistenceRevision {
  const document = input.document;
  let materialized: string | undefined;
  return {
    ...input,
    capturedAt: input.capturedAt ?? Date.now(),
    token: `${input.sessionId}:${input.revision}:${nextRevisionToken++}`,
    document,
    materialize: () => {
      if (materialized === undefined) {
        materialized = serializeDocumentSnapshot(document, getPersistenceFontCatalog());
      }
      return materialized;
    },
  };
}
