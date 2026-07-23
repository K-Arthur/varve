/**
 * Tests for concurrent safety module.
 *
 * Verifies snapshot creation, staleness detection, and edit coalescing
 * during backup operations.
 */

import type { Document } from '@strata/scene';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coalesceEditsDuringBackup,
  createBackupSnapshot,
  detectStaleInput,
  verifySnapshot,
} from './concurrentSafety';

function makeTestDocument(nodeCount = 3): Document {
  const nodes: Record<string, unknown> = {};
  for (let i = 0; i < nodeCount; i++) {
    nodes[`n${i}`] = {
      id: `n${i}`,
      kind: 'shape',
      name: `Shape ${i}`,
      order: `a${i}`,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fills: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
  }

  return {
    formatVersion: '2.7',
    id: 'doc-concurrent-test',
    name: 'Concurrent Test',
    rootChildren: Object.keys(nodes),
    nodes: nodes as Document['nodes'],
    components: {},
    nextId: nodeCount + 1,
  } as Document;
}

describe('concurrentSafety', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('createBackupSnapshot', () => {
    it('creates a snapshot with unique id', () => {
      const doc = makeTestDocument();
      const snap1 = createBackupSnapshot(doc);
      const snap2 = createBackupSnapshot(doc);
      expect(snap1.id).not.toBe(snap2.id);
    });

    it('captures document hash', () => {
      const doc = makeTestDocument();
      const snap = createBackupSnapshot(doc);
      expect(snap.documentHash).toBeTruthy();
      expect(snap.documentHash.length).toBeGreaterThan(0);
    });

    it('captures settings hash', () => {
      const doc = makeTestDocument();
      const snap = createBackupSnapshot(doc);
      expect(snap.settingsHash).toBeTruthy();
    });

    it('captures revision info', () => {
      const doc = makeTestDocument();
      const snap = createBackupSnapshot(doc);
      expect(snap.documentRevisionId).toContain('doc-concurrent-test');
    });
  });

  describe('verifySnapshot', () => {
    it('returns true for unchanged document', () => {
      const doc = makeTestDocument();
      const snap = createBackupSnapshot(doc);
      expect(verifySnapshot(doc, snap)).toBe(true);
    });

    it('returns false when document changed', () => {
      const doc = makeTestDocument(3);
      const snap = createBackupSnapshot(doc);

      // Create a modified document
      const modified = makeTestDocument(5);
      expect(verifySnapshot(modified, snap)).toBe(false);
    });

    it('returns false when settings changed', () => {
      const doc = makeTestDocument();
      const snap = createBackupSnapshot(doc);

      // Change settings
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 99 } }),
      );

      expect(verifySnapshot(doc, snap)).toBe(false);
    });
  });

  describe('detectStaleInput', () => {
    it('returns false for identical hashes', () => {
      expect(detectStaleInput('abc123', 'abc123')).toBe(false);
    });

    it('returns true for different hashes', () => {
      expect(detectStaleInput('abc123', 'def456')).toBe(true);
    });

    it('returns true for different length hashes', () => {
      expect(detectStaleInput('abc', 'abcdef')).toBe(true);
    });

    it('returns false for empty strings', () => {
      expect(detectStaleInput('', '')).toBe(false);
    });
  });

  describe('coalesceEditsDuringBackup', () => {
    it('returns snapshot doc when no changes', () => {
      const doc = makeTestDocument();
      const snap = createBackupSnapshot(doc);
      const result = coalesceEditsDuringBackup(doc, doc, snap);

      expect(result.stale).toBe(false);
      expect(result.document).toBe(doc);
    });

    it('returns current doc when snapshot is stale', () => {
      const original = makeTestDocument(3);
      const snap = createBackupSnapshot(original);

      // Modify the document
      const current = makeTestDocument(5);
      const result = coalesceEditsDuringBackup(original, current, snap);

      expect(result.stale).toBe(true);
      expect(result.document).toBe(current);
    });

    it('prefers current document on conflict', () => {
      const snapshotDoc = makeTestDocument(3);
      const snap = createBackupSnapshot(snapshotDoc);
      const currentDoc = makeTestDocument(5);
      const result = coalesceEditsDuringBackup(snapshotDoc, currentDoc, snap);

      expect(result.document).toBe(currentDoc);
    });
  });
});
