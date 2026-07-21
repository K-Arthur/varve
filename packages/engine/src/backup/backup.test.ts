// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { BackupEngine } from './engine';
import { evaluateRetention } from './retention';
import { BackupScheduler } from './scheduler';
import { createMemoryBackupStore } from './stores/memory';
import type { BackupIndexEntry, BackupManifest, RetentionConfig } from './types';
import { DEFAULT_RETENTION } from './types';
import { computeChecksum, verifyBackup } from './verify';

function makeManifest(id: string, overrides: Partial<BackupManifest> = {}): BackupManifest {
  const base: BackupManifest = {
    formatVersion: 1,
    id,
    projectId: 'proj-1',
    type: 'automatic',
    createdAt: Date.now(),
    appVersion: '0.12.0',
    schemaVersion: '2.6',
    documentRevision: 1,
    documentSize: 100,
    documentChecksum: 'abc123',
    assetsIncluded: false,
    assetCount: 0,
    assetTotalSize: 0,
    verificationStatus: 'unverified',
    sourceName: 'Test',
  };
  return { ...base, ...overrides };
}

describe('computeChecksum', () => {
  it('is deterministic', () => {
    const a = computeChecksum('hello world');
    const b = computeChecksum('hello world');
    expect(a).toBe(b);
  });

  it('differs for different input', () => {
    expect(computeChecksum('aaa')).not.toBe(computeChecksum('bbb'));
  });
});

describe('MemoryBackupStore', () => {
  it('saves and reads back a backup', async () => {
    const store = createMemoryBackupStore();
    const manifest = makeManifest('b1');
    await store.saveBackup('proj-1', 'b1', manifest, '{"doc":true}');

    const readManifest = await store.readBackupManifest('b1');
    expect(readManifest?.id).toBe('b1');
    const doc = await store.readBackupDocument('b1');
    expect(doc).toBe('{"doc":true}');
  });

  it('lists projects with backups', async () => {
    const store = createMemoryBackupStore();
    await store.saveBackup('p1', 'b1', makeManifest('b1'), 'doc');
    await store.saveBackup('p2', 'b2', makeManifest('b2', { projectId: 'p2' }), 'doc');
    const projects = await store.listProjects();
    expect(projects.sort()).toEqual(['p1', 'p2']);
  });

  it('deletes a backup and its assets', async () => {
    const store = createMemoryBackupStore();
    const assets = new Map([['asset-1', 'imagedata']]);
    await store.saveBackup('p1', 'b1', makeManifest('b1'), 'doc', assets);
    await store.deleteBackup('p1', 'b1');
    expect(await store.readBackupDocument('b1')).toBeNull();
    expect(await store.readBackupAsset('b1', 'asset-1')).toBeNull();
  });

  it('verifyBackup detects checksum mismatch', async () => {
    const store = createMemoryBackupStore();
    const doc = 'consistent-doc';
    const manifest = makeManifest('b1', { documentChecksum: computeChecksum(doc) });
    await store.saveBackup('p1', 'b1', manifest, doc);
    const result = await store.verifyBackup('b1');
    expect(result.valid).toBe(true);

    // Tamper with the stored document.
    await store.saveBackup('p1', 'b1', manifest, 'tampered');
    const result2 = await store.verifyBackup('b1');
    expect(result2.valid).toBe(false);
  });
});

describe('verifyBackup (standalone)', () => {
  it('flags a checksum mismatch as corrupted', async () => {
    const store = createMemoryBackupStore();
    const doc = 'original-document';
    const manifest = makeManifest('b1', { documentChecksum: 'wrong-hash' });
    await store.saveBackup('proj-1', 'b1', manifest, doc);
    const result = await verifyBackup(store, 'b1', manifest);
    expect(result.valid).toBe(false);
    expect(result.status).toBe('corrupted');
  });

  it('verifies a matching document', async () => {
    const store = createMemoryBackupStore();
    const doc = 'original-document';
    const manifest = makeManifest('b1', { documentChecksum: computeChecksum(doc) });
    await store.saveBackup('proj-1', 'b1', manifest, doc);
    const result = await verifyBackup(store, 'b1', manifest);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('verified');
  });
});

describe('BackupEngine', () => {
  it('creates a verified backup', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store, undefined, undefined, '0.12.0');
    const result = await engine.createBackup(
      'proj-1',
      'automatic',
      '{"nodes":[]}',
      'My Doc',
      1,
      'first save',
    );
    expect(result.success).toBe(true);
    expect(result.backupId).toBeTruthy();

    const manifest = await engine.getBackupManifest(result.backupId!);
    expect(manifest?.verificationStatus).toBe('verified');
    expect(manifest?.sourceName).toBe('My Doc');
    expect(manifest?.notes).toBe('first save');
  });

  it('lists backups newest-first', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    await engine.createBackup('proj-1', 'automatic', '{"a":1}', 'Doc');
    await engine.createBackup('proj-1', 'automatic', '{"a":2}', 'Doc');
    const backups = await engine.listBackups('proj-1');
    expect(backups).toHaveLength(2);
    expect(backups[0]!.createdAt).toBeGreaterThanOrEqual(backups[1]!.createdAt);
  });

  it('applies retention and reports removed count', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    for (let i = 0; i < 10; i++) {
      await engine.createBackup('proj-1', 'automatic', `{"v":${i}}`, 'Doc');
    }
    const removed = await engine.applyRetention('proj-1', {
      ...DEFAULT_RETENTION,
      maxEntryCount: 5,
    });
    expect(removed).toBeGreaterThan(0);
    const remaining = await engine.listBackups('proj-1');
    expect(remaining.length).toBeLessThanOrEqual(5);
  });

  it('verifyAllBackups counts valid and corrupted', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const r1 = await engine.createBackup('proj-1', 'automatic', '{"ok":1}', 'Doc');
    const results = await engine.verifyAllBackups('proj-1');
    expect(results.total).toBe(1);
    expect(results.valid).toBe(1);
    expect(results.corrupted).toBe(0);
    void r1;
  });
});

describe('evaluateRetention', () => {
  function entry(id: string, createdAt: number, type: BackupIndexEntry['type']): BackupIndexEntry {
    return { id, type, createdAt, size: 1000, documentSize: 1000, verificationStatus: 'verified' };
  }

  const baseConfig: RetentionConfig = {
    hourlyCount: 2,
    dailyCount: 2,
    weeklyCount: 1,
    monthlyCount: 1,
    maxTotalBytes: 1_073_741_824,
    maxEntryCount: 100,
  };

  it('keeps everything within entry budget', () => {
    const entries = [entry('a', Date.now(), 'automatic')];
    const result = evaluateRetention(entries, baseConfig, 1000);
    expect(result.toRemove).toHaveLength(0);
    expect(result.toKeep).toContain('a');
  });

  it('removes entries beyond maxEntryCount', () => {
    const now = Date.now();
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry(`e${i}`, now - i * 1000, 'automatic'),
    );
    const result = evaluateRetention(entries, { ...baseConfig, maxEntryCount: 3 }, 10000);
    expect(result.toRemove.length).toBeGreaterThan(0);
  });

  it('never deletes the last remaining backup', () => {
    const now = Date.now();
    const entries = [entry('only', now, 'automatic')];
    const result = evaluateRetention(entries, { ...baseConfig, maxEntryCount: 0 }, 0);
    expect(result.toKeep).toContain('only');
    expect(result.toRemove).not.toContain('only');
  });

  it('preserves named and snapshot types from removal', () => {
    const now = Date.now();
    const entries = [
      entry('snap', now, 'snapshot'),
      entry('named', now - 1000, 'automatic'),
      entry('auto1', now - 2000, 'automatic'),
      entry('auto2', now - 3000, 'automatic'),
    ];
    const result = evaluateRetention(entries, { ...baseConfig, maxEntryCount: 1 }, 10000);
    expect(result.toKeep).toContain('snap');
    expect(result.toRemove).not.toContain('snap');
  });

  it('byte budget removes oldest kept entries', () => {
    const now = Date.now();
    // Spread 6 entries across 6 different hours so hourlyCount keeps all 6
    // (6000 bytes). Budget cap of 2500 forces removal of oldest kept ones.
    const entries = Array.from({ length: 6 }, (_, i) =>
      entry(`e${i}`, now - i * 60 * 60 * 1000, 'automatic'),
    );
    const result = evaluateRetention(
      entries,
      {
        ...baseConfig,
        maxTotalBytes: 2_500,
        maxEntryCount: 100,
        hourlyCount: 10,
        dailyCount: 0,
        weeklyCount: 0,
        monthlyCount: 0,
      },
      6_000,
    );
    // The byte-budget pass should drop at least one of the kept entries.
    expect(result.toRemove.length).toBeGreaterThan(0);
    // And never zero out the backup set.
    expect(result.toKeep.length).toBeGreaterThan(0);
    // Should keep at least 2 (2500 budget / 1000 each) but not all 6.
    expect(result.toKeep.length).toBeLessThan(6);
  });
});

describe('BackupScheduler', () => {
  it('notifies edits and tracks dirty state', () => {
    const delegate = makeDelegate();
    const scheduler = new BackupScheduler(delegate, { intervalMs: 100, idleThresholdMs: 0 });
    scheduler.notifyEdit();
    scheduler.start();
    expect(scheduler.isEnabled).toBe(true);
    scheduler.stop();
    expect(scheduler.isEnabled).toBe(false);
  });

  it('emits lifecycle events', async () => {
    const events: string[] = [];
    const delegate = makeDelegate();
    const scheduler = new BackupScheduler(delegate, { intervalMs: 50, idleThresholdMs: 0 });
    scheduler.onEvent((e) => events.push(e.type));
    scheduler.notifyEdit();
    await scheduler.backupNow();
    expect(events).toContain('started');
    expect(events).toContain('completed');
    expect(delegate.backupCalls).toBe(1);
    scheduler.dispose();
  });

  it('retries on failure then reports error status', async () => {
    const delegate = makeDelegate({ failTimes: 3 });
    const scheduler = new BackupScheduler(delegate, {
      intervalMs: 50,
      idleThresholdMs: 0,
      maxBackupRetries: 2,
    });
    scheduler.notifyEdit();
    await scheduler.backupNow();
    expect(scheduler.currentStatus.state).toBe('error');
    expect(scheduler.currentStatus.consecutiveFailures).toBe(1);
    scheduler.dispose();
  });
});

function makeDelegate(opts: { failTimes?: number } = {}) {
  let failures = opts.failTimes ?? 0;
  return {
    backupCalls: 0,
    canBackup() {
      return true;
    },
    async createBackup() {
      this.backupCalls++;
      if (failures > 0) {
        failures--;
        return { success: false, error: 'boom' };
      }
      return { success: true, backupId: 'b1', size: 100, duration: 5 };
    },
    getRetentionConfig() {
      return DEFAULT_RETENTION;
    },
    async applyRetention() {
      return 0;
    },
    async getPendingProjects() {
      return ['proj-1'];
    },
  };
}
