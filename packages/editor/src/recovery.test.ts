/**
 * Tests for RecoveryManager and its storage implementations.
 */

import { getStorageWriteMetrics, resetStorageWriteMetrics } from '@varve/platform';
import {
  addNode,
  createDocument,
  createEmptyTile,
  DocumentCodec,
  makeRasterLayerNode,
} from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSharedRecoveryManager,
  MemoryRecoveryStorage,
  RecoveryManager,
  ResilientRecoveryStorage,
} from './recovery';

describe('MemoryRecoveryStorage', () => {
  let storage: MemoryRecoveryStorage;

  beforeEach(() => {
    storage = new MemoryRecoveryStorage();
  });

  it('saves and loads data', async () => {
    await storage.save('key1', 'data1');
    const result = await storage.load('key1');
    expect(result).toBe('data1');
  });

  it('returns null for missing key', async () => {
    const result = await storage.load('nonexistent');
    expect(result).toBeNull();
  });

  it('lists keys', async () => {
    await storage.save('a', '1');
    await storage.save('b', '2');
    const keys = await storage.list();
    expect(keys).toEqual(['a', 'b']);
  });

  it('deletes a key', async () => {
    await storage.save('k', 'v');
    await storage.delete('k');
    const result = await storage.load('k');
    expect(result).toBeNull();
  });

  it('list returns empty array for empty storage', async () => {
    const keys = await storage.list();
    expect(keys).toEqual([]);
  });
});

describe('ResilientRecoveryStorage', () => {
  it('keeps recovery points in session memory when IndexedDB is blocked', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    });
    try {
      const storage = new ResilientRecoveryStorage();
      await storage.save('recovery-blocked', 'data');
      expect(await storage.list()).toEqual(['recovery-blocked']);
      expect(await storage.load('recovery-blocked')).toBe('data');
      await storage.delete('recovery-blocked');
      expect(await storage.list()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('RecoveryManager', () => {
  let storage: MemoryRecoveryStorage;
  let manager: RecoveryManager;

  beforeEach(() => {
    storage = new MemoryRecoveryStorage();
    manager = new RecoveryManager(storage);
  });

  it('creates and lists a recovery session', async () => {
    const doc = { formatVersion: '1.0', name: 'test', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'Untitled');
    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tabName).toBe('Untitled');
    expect(sessions[0]?.fileId).toBeUndefined();
    expect(sessions[0]?.filePath).toBeUndefined();
    expect(sessions[0]?.timestamp).toBeGreaterThan(0);
    expect(sessions[0]?.id).toBeTruthy();
  });

  it('records a logical recovery write for each point', async () => {
    resetStorageWriteMetrics();
    const doc = { formatVersion: '1.0', name: 'telemetry', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'Telemetry');
    expect(getStorageWriteMetrics().byKind.recovery.writes).toBe(1);
    expect(getStorageWriteMetrics().byKind.recovery.logicalBytes).toBeGreaterThan(0);
  });

  it('restores a session', async () => {
    const doc = { formatVersion: '1.0', name: 'restore-test', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'My Tab', 'file-1', '/path/to/file');
    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toBeDefined();
    const restored = await manager.restoreSession(sessions[0]?.id as string);
    expect(restored).not.toBeNull();
    expect(restored?.tabName).toBe('My Tab');
    expect(restored?.fileId).toBe('file-1');
    expect(restored?.filePath).toBe('/path/to/file');
    expect(restored?.document.name).toBe('restore-test');
  });

  it('deletes a session', async () => {
    const doc = { formatVersion: '1.0', name: 'test', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'Tab');
    const sessions1 = await manager.listSessions();
    expect(sessions1).toHaveLength(1);
    expect(sessions1[0]).toBeDefined();
    await manager.deleteSession(sessions1[0]?.id as string);
    const sessions2 = await manager.listSessions();
    expect(sessions2).toHaveLength(0);
  });

  it('cleanup removes sessions older than maxAge', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const doc = { formatVersion: '1.0', name: 'old', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'Old Tab');
    vi.setSystemTime(now + 10 * 24 * 60 * 60 * 1000); // 10 days later
    const removed = await manager.cleanup(7 * 24 * 60 * 60 * 1000); // 7 days max age
    expect(removed).toBe(1);
    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(0);
    vi.useRealTimers();
  });

  it('hasSessions returns true/false', async () => {
    expect(await manager.hasSessions()).toBe(false);
    const doc = { formatVersion: '1.0', name: 'test', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'Tab');
    expect(await manager.hasSessions()).toBe(true);
  });

  it('supports multiple sessions', async () => {
    const doc = { formatVersion: '1.0', name: 'test', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'Tab 1');
    await manager.createRecoveryPoint(doc as never, 'Tab 2');
    await manager.createRecoveryPoint(doc as never, 'Tab 3');
    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(3);
    expect(sessions.map((s) => s.tabName).sort()).toEqual(['Tab 1', 'Tab 2', 'Tab 3']);
  });

  it('handles corrupt recovery data gracefully', async () => {
    await storage.save('recovery_corrupt', 'not valid json');
    const sessions = await manager.listSessions();
    // Corrupt data should be skipped or return empty
    expect(sessions).toHaveLength(0);
  });

  it('restoreSession returns null for missing session', async () => {
    const result = await manager.restoreSession('nonexistent');
    expect(result).toBeNull();
  });

  it('preserves raster tile pixels across a recovery point', async () => {
    let doc = createDocument('recovery-raster');
    const node = makeRasterLayerNode('rl-recover', { width: 256, height: 256 });
    const tile = createEmptyTile();
    tile.pixels.set([12, 34, 56, 255]);
    node.tiles.set('0:0', tile);
    doc = addNode(doc, node);

    await manager.createRecoveryPoint(doc, 'Raster Tab');
    const sessions = await manager.listSessions();
    const restored = await manager.restoreSession(sessions[0]!.id);
    expect(restored).not.toBeNull();

    // The real restore path re-encodes the returned object and loads it
    // through DocumentCodec; assert tiles survive that complete path.
    const decoded = DocumentCodec.decode(JSON.stringify(restored!.document));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const restoredNode = decoded.document.nodes['rl-recover'];
    expect(restoredNode?.kind).toBe('rasterLayer');
    if (restoredNode?.kind !== 'rasterLayer') return;
    expect(restoredNode.tiles).toBeInstanceOf(Map);
    expect([...restoredNode.tiles.get('0:0')!.pixels.slice(0, 4)]).toEqual([12, 34, 56, 255]);
  });

  it('cleanup preserves recent sessions', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const doc = { formatVersion: '1.0', name: 'test', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'Recent Tab');
    await manager.createRecoveryPoint(doc as never, 'Another Recent');
    const removed = await manager.cleanup(7 * 24 * 60 * 60 * 1000);
    expect(removed).toBe(0);
    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(2);
    vi.useRealTimers();
  });

  it('createRecoveryPoint with fileId', async () => {
    const doc = { formatVersion: '1.0', name: 'file-test', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'File Tab', 'my-file-id');
    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.fileId).toBe('my-file-id');
  });

  it('createRecoveryPoint without fileId works', async () => {
    const doc = { formatVersion: '1.0', name: 'no-file', nodes: {}, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'No File');
    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.fileId).toBeUndefined();
    expect(sessions[0]?.filePath).toBeUndefined();
  });

  it('enforces max sessions limit (default 20)', async () => {
    const doc = { formatVersion: '1.0', name: 'test', nodes: {}, rootChildren: [] };
    for (let i = 0; i < 25; i++) {
      await manager.createRecoveryPoint(doc as never, `Tab ${i}`);
    }
    const sessions = await manager.listSessions();
    expect(sessions.length).toBeLessThanOrEqual(20);
  });

  it('verifySession returns true for valid session', async () => {
    const doc = { formatVersion: '1.0', name: 'test', nodes: { a: {} }, rootChildren: [] };
    await manager.createRecoveryPoint(doc as never, 'Tab');
    const sessions = await manager.listSessions();
    const id = sessions[0]?.id;
    expect(await manager.verifySession(id!)).toBe(true);
  });

  it('verifySession returns false for missing session', async () => {
    expect(await manager.verifySession('nonexistent')).toBe(false);
  });

  it('verifySession returns false for corrupt session', async () => {
    await storage.save('recovery_corrupt', 'not valid json');
    expect(await manager.verifySession('corrupt')).toBe(false);
  });

  it('listSessionsMeta includes nodeCount and sizeBytes', async () => {
    const doc = {
      formatVersion: '1.0',
      name: 'test',
      nodes: { a: {}, b: {}, c: {} },
      rootChildren: [],
    };
    await manager.createRecoveryPoint(doc as never, 'Tab');
    const metas = await manager.listSessionsMeta();
    expect(metas).toHaveLength(1);
    expect(metas[0]?.nodeCount).toBe(3);
    expect(metas[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it('listSessionsMeta handles corrupt entries gracefully', async () => {
    await storage.save('recovery_corrupt', 'not json');
    const metas = await manager.listSessionsMeta();
    expect(metas).toHaveLength(0);
  });

  describe('deleteRecoveryForTab', () => {
    const doc = { formatVersion: '1.0', name: 'test', nodes: {}, rootChildren: [] };

    it('deletes recovery points bound to a discarded fileId', async () => {
      await manager.createRecoveryPoint(doc as never, 'Poster.varve', 'file-1');
      await manager.createRecoveryPoint(doc as never, 'Other.varve', 'file-2');
      const removed = await manager.deleteRecoveryForTab('Poster.varve', 'file-1');
      expect(removed).toBe(1);
      const remaining = await manager.listSessions();
      expect(remaining.map((s) => s.fileId)).toEqual(['file-2']);
    });

    it('deletes a uniquely named untitled recovery point', async () => {
      await manager.createRecoveryPoint(doc as never, 'Untitled');
      const removed = await manager.deleteRecoveryForTab('Untitled');
      expect(removed).toBe(1);
      expect(await manager.listSessions()).toHaveLength(0);
    });

    it('keeps duplicate untitled recovery points rather than guessing', async () => {
      await manager.createRecoveryPoint(doc as never, 'Untitled');
      await manager.createRecoveryPoint(doc as never, 'Untitled');
      const removed = await manager.deleteRecoveryForTab('Untitled');
      expect(removed).toBe(0);
      expect(await manager.listSessions()).toHaveLength(2);
    });
  });

  describe('recovery byte cap', () => {
    function paddedDoc(label: string): Record<string, unknown> {
      return {
        formatVersion: '1.0',
        name: label,
        nodes: {},
        rootChildren: [],
        padding: 'x'.repeat(1200),
      };
    }

    it('evicts oldest redundant points when the byte cap is exceeded', async () => {
      const capped = new RecoveryManager(storage, 2500);
      let now = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));

      await capped.createRecoveryPoint(paddedDoc('first') as never, 'Untitled');
      await capped.createRecoveryPoint(paddedDoc('second') as never, 'Untitled');
      await capped.createRecoveryPoint(paddedDoc('third') as never, 'Untitled');

      const metas = await capped.listSessionsMeta();
      expect(metas).toHaveLength(1);
      const raw = await storage.load(`recovery_${metas[0]!.id}`);
      expect(raw).toContain('third');
      vi.restoreAllMocks();
    });

    it('never deletes the newest point for a tab to satisfy the byte cap', async () => {
      const capped = new RecoveryManager(storage, 100);

      await capped.createRecoveryPoint(paddedDoc('only-copy') as never, 'Unsaved');

      // The point is larger than the cap, but it is the tab's only recovery
      // copy; the cap must not delete it.
      expect(await capped.listSessionsMeta()).toHaveLength(1);
    });

    it('keeps the newest point of each tab when many tabs exceed the cap', async () => {
      const capped = new RecoveryManager(storage, 2600);
      let now = 5000;
      vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));

      await capped.createRecoveryPoint(paddedDoc('a-old') as never, 'Tab A');
      await capped.createRecoveryPoint(paddedDoc('a-new') as never, 'Tab A');
      await capped.createRecoveryPoint(paddedDoc('b-new') as never, 'Tab B');

      const metas = await capped.listSessionsMeta();
      expect(metas.map((m) => m.tabName).sort()).toEqual(['Tab A', 'Tab B']);
      const newestA = metas.find((m) => m.tabName === 'Tab A');
      const rawA = await storage.load(`recovery_${newestA!.id}`);
      expect(rawA).toContain('a-new');
      vi.restoreAllMocks();
    });
  });
});

describe('getSharedRecoveryManager', () => {
  it('returns the same instance on repeated calls', () => {
    const mgr1 = getSharedRecoveryManager();
    const mgr2 = getSharedRecoveryManager();
    expect(mgr1).toBe(mgr2);
  });
});
