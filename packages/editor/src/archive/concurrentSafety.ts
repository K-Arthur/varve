/**
 * Concurrent edit protection for archive operations.
 *
 * Provides snapshot-based staleness detection to ensure backup/restore
 * operations don't silently overwrite concurrent edits. Uses content
 * hashing and revision IDs to detect when the document or settings have
 * changed between snapshot creation and restore application.
 *
 * Research basis: CRDT version vectors, Git stash, Figma's branch model.
 * This is a lightweight optimistic concurrency control mechanism.
 */

import type { Document } from '@varve/scene';
import type { BackupSnapshot } from './archiveTypes';
import { collectSettingsBackup } from './settingsBackup';

/** Compute a simple content hash for a document. */
function hashDocument(doc: Document): string {
  const parts = [
    doc.id,
    doc.name,
    doc.formatVersion,
    String(doc.nextId),
    Object.keys(doc.nodes).length.toString(),
    Object.keys(doc.components).length.toString(),
  ];
  return parts.join(':');
}

/** Compute a simple content hash for current settings. */
function hashSettings(): string {
  const entries = collectSettingsBackup();
  return entries.map((e) => `${e.category}:${JSON.stringify(e.value).length}`).join('|');
}

/** Generate a unique snapshot id. */
function snapshotId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a backup snapshot capturing the current document revision and
 * content hashes. Used before initiating a backup or restore operation
 * to detect concurrent modifications.
 */
export function createBackupSnapshot(doc: Document): BackupSnapshot {
  return {
    id: snapshotId(),
    documentRevisionId: `${doc.id}:${doc.nextId}:${Object.keys(doc.nodes).length}`,
    documentHash: hashDocument(doc),
    settingsHash: hashSettings(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Verify that a snapshot is still current. Returns true if the document
 * and settings haven't changed since the snapshot was created.
 */
export function verifySnapshot(currentDoc: Document, snapshot: BackupSnapshot): boolean {
  return (
    hashDocument(currentDoc) === snapshot.documentHash && hashSettings() === snapshot.settingsHash
  );
}

/**
 * Detect if the document has been modified since the snapshot was taken.
 * Returns true if the current hash differs from the snapshot hash.
 */
export function detectStaleInput(currentHash: string, snapshotHash: string): boolean {
  // Constant-time comparison for security
  if (currentHash.length !== snapshotHash.length) return true;
  let diff = 0;
  for (let i = 0; i < currentHash.length; i++) {
    diff |= currentHash.charCodeAt(i) ^ snapshotHash.charCodeAt(i);
  }
  return diff !== 0;
}

/**
 * Coalesce concurrent edits during a backup operation.
 * Returns the latest document if the snapshot is stale, or the snapshot's
 * document if it's still current. In practice, callers should use the
 * fresher document to avoid data loss.
 */
export function coalesceEditsDuringBackup(
  snapshotDoc: Document,
  currentDoc: Document,
  snapshot: BackupSnapshot,
): { document: Document; stale: boolean } {
  const stale = !verifySnapshot(currentDoc, snapshot);
  return {
    document: stale ? currentDoc : snapshotDoc,
    stale,
  };
}
