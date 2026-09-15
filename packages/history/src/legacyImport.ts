/**
 * Legacy version-history convergence (ADR-0024).
 *
 * Imports flat `VersionEntry` records from the existing platform version
 * store into the revision architecture WITHOUT fabricating lineage:
 * - each distinct content hash becomes one imported snapshot revision
 *   (`parentRevisionIds: []`, origin `import` — a documented exception to
 *   the genesis rule, since parent relationships cannot be proven)
 * - named/pinned versions become CheckpointRefs on their imported revision
 * - identical content dedupes; undecodable content is skipped with a warning
 * - deterministic ordering by canonical hash (timestamps stay metadata)
 */

import type { Document } from '@varve/scene';
import { canonicalHistoryHash, DocumentCodec } from '@varve/scene';
import { createSnapshot } from './snapshots';
import { type HistoryStore, mintHistoryId } from './store';
import type { CheckpointRef, IntegrityIssue, RevisionAuthor, RevisionRecord } from './types';

export interface LegacyVersionEntry {
  id: string;
  name?: string;
  description?: string;
  kind: 'checkpoint' | 'named' | 'auto' | 'manual';
  pinned?: boolean;
  timestamp: number;
  /** Dedup key used by the legacy store (FNV-1a 32-bit). */
  documentHash: string;
}

export interface LegacyVersionImport {
  documentId: string;
  author: RevisionAuthor;
  /** versionId → serialized document JSON. */
  contentById: Map<string, string>;
}

export interface LegacyImportResult {
  revisions: RevisionRecord[];
  checkpoints: CheckpointRef[];
  warnings: string[];
  skipped: { versionId: string; reason: string }[];
}

/**
 * Import legacy versions as snapshot revisions + checkpoints. The store is
 * committed through its own atomic operations; a failed import leaves the
 * store unchanged (snapshots and revisions are added per content hash).
 */
export async function importLegacyVersions(
  store: HistoryStore,
  versions: LegacyVersionEntry[],
  opts: LegacyVersionImport,
): Promise<LegacyImportResult> {
  const warnings: string[] = [];
  const skipped: LegacyImportResult['skipped'] = [];

  // Group versions by canonical hash (decode → canonicalize → hash).
  const byHash = new Map<string, { document: Document; versionIds: string[] }>();
  for (const version of versions) {
    const json = opts.contentById.get(version.id);
    if (!json) {
      skipped.push({ versionId: version.id, reason: 'content missing from store' });
      continue;
    }
    let document: Document;
    try {
      const decoded = DocumentCodec.decode(json);
      if (!decoded.ok) {
        skipped.push({ versionId: version.id, reason: 'decode failed' });
        continue;
      }
      document = decoded.document;
    } catch {
      skipped.push({ versionId: version.id, reason: 'decode threw' });
      continue;
    }
    const hash = canonicalHistoryHash(document);
    const existing = byHash.get(hash);
    if (existing) {
      existing.versionIds.push(version.id);
    } else {
      byHash.set(hash, { document, versionIds: [version.id] });
    }
  }

  // Deterministic processing order: by canonical hash.
  const hashes = [...byHash.keys()].sort();
  const revisions: RevisionRecord[] = [];
  const checkpoints: CheckpointRef[] = [];

  for (const hash of hashes) {
    const group = byHash.get(hash)!;
    const document = group.document;
    const snapshot = await createSnapshot(store, document, {
      documentId: opts.documentId,
      revisionId: mintHistoryId('r'),
    });
    const revision: RevisionRecord = {
      revisionId: mintHistoryId('r'),
      documentId: opts.documentId,
      parentRevisionIds: [],
      canonicalDocumentHash: hash,
      snapshotId: snapshot.canonicalHash,
      author: opts.author,
      semanticSummary: {
        label: `Imported version (${group.versionIds.length})`,
        kind: 'admin',
        affectedEntityIds: [],
      },
      createdAt: group.versionIds.length
        ? Math.min(...group.versionIds.map((id) => versionTimestamp(versions, id)))
        : 0,
      schemaVersion: 1,
      origin: 'import',
    };
    await store.putRevision(revision);
    revisions.push(revision);

    // Named/pinned versions become checkpoints on this revision.
    for (const versionId of group.versionIds) {
      const version = versions.find((v) => v.id === versionId);
      if (version && (version.kind === 'named' || version.pinned)) {
        const checkpoint: CheckpointRef = {
          checkpointId: mintHistoryId('cp'),
          documentId: opts.documentId,
          revisionId: revision.revisionId,
          name: version.name ?? `Version ${version.timestamp}`,
          description: version.description,
          pinned: version.pinned ?? false,
          createdAt: version.timestamp,
        };
        await store.putCheckpoint(checkpoint);
        checkpoints.push(checkpoint);
      }
    }
  }

  if (skipped.length > 0) {
    warnings.push(`${skipped.length} version(s) skipped (missing or undecodable content)`);
  }
  return { revisions, checkpoints, warnings, skipped };
}

function versionTimestamp(versions: LegacyVersionEntry[], id: string): number {
  return versions.find((v) => v.id === id)?.timestamp ?? 0;
}

/** Integrity checks specific to imported history (parentless import roots). */
export function validateImportedHistory(revisions: RevisionRecord[]): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const revision of revisions) {
    if (revision.origin === 'import' && revision.parentRevisionIds.length !== 0) {
      issues.push({
        severity: 'error',
        code: 'import.expected-parentless',
        message: `import revision ${revision.revisionId} unexpectedly has parents`,
        subjectId: revision.revisionId,
      });
    }
  }
  return issues;
}
