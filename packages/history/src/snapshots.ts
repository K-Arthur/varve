/**
 * Content-addressed snapshots and scheduling policy (ADR-0021).
 *
 * A snapshot is the canonical text of a document keyed by its SHA-256
 * canonical hash — identical content dedupes to one record. Snapshot
 * triggers are thresholds (operation count, replayed bytes, replay time,
 * explicit checkpoint, shutdown), never every-transaction.
 */

import type { Document } from '@varve/scene';
import { canonicalHistoryHash, DocumentCodec } from '@varve/scene';
import type { HistoryStore } from './store';

export interface SnapshotRecord {
  /** Content address: the canonical SHA-256 digest. */
  canonicalHash: string;
  documentId: string;
  canonicalText: string;
  /**
   * `document-codec` preserves live raster Maps as the codec's base64 tile
   * representation. Legacy snapshots omitted this field and used canonical
   * JSON, which cannot faithfully rehydrate a typed-array tile map.
   */
  encoding?: 'document-codec';
  /** Revision whose end state this snapshot represents. */
  revisionId: string;
  schemaVersion: number;
  createdAt: number;
}

export interface SnapshotPolicy {
  /** Operations since the last snapshot before a new one is due. */
  minOperationsBetweenSnapshots: number;
  /** Replayed canonical bytes since the last snapshot. */
  minReplayedBytes: number;
  /** Replay time (ms) since the last snapshot. */
  minReplayMs: number;
  /** Always snapshot at an explicit checkpoint. */
  snapshotOnCheckpoint: boolean;
}

export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
  minOperationsBetweenSnapshots: 1_000,
  minReplayedBytes: 5_000_000,
  minReplayMs: 250,
  snapshotOnCheckpoint: true,
};

export interface SnapshotStats {
  operationsSinceSnapshot: number;
  replayedBytesSinceSnapshot: number;
  replayMsSinceSnapshot: number;
  /** True when the current commit is an explicit checkpoint. */
  atCheckpoint: boolean;
  /** True when the commit is a clean application shutdown. */
  atShutdown: boolean;
}

/** Pure scheduling decision: should the current commit also snapshot? */
export function shouldSnapshot(stats: SnapshotStats, policy: SnapshotPolicy): boolean {
  if (stats.atCheckpoint && policy.snapshotOnCheckpoint) return true;
  if (stats.atShutdown) return true;
  if (stats.operationsSinceSnapshot >= policy.minOperationsBetweenSnapshots) return true;
  if (stats.replayedBytesSinceSnapshot >= policy.minReplayedBytes) return true;
  if (stats.replayMsSinceSnapshot >= policy.minReplayMs) return true;
  return false;
}

/** Snapshot a document state (deduped by canonical hash). */
export async function createSnapshot(
  store: HistoryStore,
  document: Document,
  opts: { documentId: string; revisionId: string; schemaVersion?: number },
): Promise<SnapshotRecord> {
  // `canonicalizeDocument` is perfect hash input but converts typed arrays
  // to number arrays. A history snapshot must instead round-trip the live
  // scene representation, including `Map<string, RasterTile>`.
  const canonicalText = DocumentCodec.encode(document);
  const hash = canonicalHistoryHash(document);
  const existing = await store.getSnapshot(opts.documentId, hash);
  if (existing?.encoding === 'document-codec') return existing;
  const snapshot: SnapshotRecord = {
    canonicalHash: hash,
    documentId: opts.documentId,
    canonicalText,
    encoding: 'document-codec',
    revisionId: opts.revisionId,
    schemaVersion: opts.schemaVersion ?? 1,
    createdAt: Date.now(),
  };
  await store.putSnapshot(snapshot);
  return snapshot;
}

/** Parse a snapshot's canonical text back into a live document. */
export function snapshotToDocument(snapshot: SnapshotRecord): Document {
  if (snapshot.encoding !== 'document-codec') {
    // Existing non-raster snapshots retain their historical behavior. Do not
    // pretend a legacy raster snapshot is safe: raw canonical JSON has lost
    // the typed-array encoding and must not fabricate pixels during replay.
    const parsed = JSON.parse(snapshot.canonicalText) as Document;
    const hasLegacyRaster = Object.values(parsed.nodes ?? {}).some(
      (node) => node?.kind === 'rasterLayer' && !(node.tiles instanceof Map),
    );
    if (hasLegacyRaster) {
      throw new Error('legacy raster snapshot cannot be restored losslessly');
    }
    return parsed;
  }
  const decoded = DocumentCodec.decode(snapshot.canonicalText);
  if (!decoded.ok) throw new Error(`snapshot decode failed: ${decoded.error}`);
  const actual = canonicalHistoryHash(decoded.document);
  if (actual !== snapshot.canonicalHash) {
    throw new Error(
      `snapshot canonical hash mismatch: expected ${snapshot.canonicalHash}, got ${actual}`,
    );
  }
  return decoded.document;
}

/**
 * In-memory scheduler tracking replay stats between snapshots. Editor
 * integration wires transaction commits into `noteCommit`; the scheduler
 * itself is pure bookkeeping.
 */
export class SnapshotScheduler {
  private operationsSinceSnapshot = 0;
  private replayedBytesSinceSnapshot = 0;
  private replayMsSinceSnapshot = 0;

  constructor(private readonly policy: SnapshotPolicy = DEFAULT_SNAPSHOT_POLICY) {}

  noteCommit(
    stats: Pick<
      SnapshotStats,
      'replayedBytesSinceSnapshot' | 'replayMsSinceSnapshot' | 'atCheckpoint' | 'atShutdown'
    >,
  ): boolean {
    this.operationsSinceSnapshot += 1;
    this.replayedBytesSinceSnapshot += stats.replayedBytesSinceSnapshot ?? 0;
    this.replayMsSinceSnapshot += stats.replayMsSinceSnapshot ?? 0;
    const due = shouldSnapshot(
      {
        operationsSinceSnapshot: this.operationsSinceSnapshot,
        replayedBytesSinceSnapshot: this.replayedBytesSinceSnapshot,
        replayMsSinceSnapshot: this.replayMsSinceSnapshot,
        atCheckpoint: stats.atCheckpoint,
        atShutdown: stats.atShutdown,
      },
      this.policy,
    );
    if (due) this.reset();
    return due;
  }

  reset(): void {
    this.operationsSinceSnapshot = 0;
    this.replayedBytesSinceSnapshot = 0;
    this.replayMsSinceSnapshot = 0;
  }

  stats(): SnapshotStats {
    return {
      operationsSinceSnapshot: this.operationsSinceSnapshot,
      replayedBytesSinceSnapshot: this.replayedBytesSinceSnapshot,
      replayMsSinceSnapshot: this.replayMsSinceSnapshot,
      atCheckpoint: false,
      atShutdown: false,
    };
  }
}
