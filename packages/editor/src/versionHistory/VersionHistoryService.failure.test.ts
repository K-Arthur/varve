// @vitest-environment jsdom

import { createMemoryPlatform } from '@varve/platform';
/**
 * Failure injection tests for VersionHistoryService.
 *
 * Tests crash-safety, corruption resilience, dedup under concurrent access,
 * and behavior at storage boundaries. These verify the system degrades
 * gracefully rather than losing data or corrupting history.
 */
import type { Document } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { VersionHistoryService } from './VersionHistoryService';

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    name: 'Test',
    formatVersion: '2.5',
    rootChildren: ['n1'],
    nodes: {
      n1: {
        id: 'n1',
        kind: 'shape',
        name: 'Rect',
        transform: [1, 0, 0, 1, 0, 0],
        shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        fills: [{ type: 'solid', color: [255, 0, 0, 255] }],
        strokes: [],
        effects: [],
        filters: [],
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
      } as unknown as Document['nodes']['n1'],
    } as unknown as Document['nodes'],
    components: {},
    nextId: 2,
    ...overrides,
  } as unknown as Document;
}

async function setup() {
  const platform = createMemoryPlatform();
  const fileId = 'file-1';
  await platform.upsertFile(
    {
      id: fileId,
      name: 'Test',
      kind: 'strata',
      projectId: null,
      createdAt: 0,
      updatedAt: 0,
      openedAt: 0,
      size: 0,
      pinned: false,
      trashedAt: null,
      ordering: '',
      contentHash: '',
    },
    '{}',
  );
  const service = new VersionHistoryService(platform, {
    autoVersionIntervalMs: 0,
    maxAutoVersions: 5,
    maxTotalVersions: 10,
  });
  return { platform, fileId, service };
}

describe('VersionHistoryService failure injection', () => {
  it('survives rapid identical saves (content dedup under load)', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    // Simulate 100 rapid saves of the same content. Concurrent calls may
    // each create a version record (no locking), but content is deduplicated
    // in storage — all share one content hash.
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        service.createVersion({ fileId, kind: 'auto', origin: 'autosave' }, doc),
      ),
    );
    // All calls succeed (no crash), but content is shared.
    const created = results.filter((r) => r !== null);
    expect(created.length).toBeGreaterThan(0);
    const list = await service.listVersions(fileId);
    expect(list.length).toBeGreaterThan(0);
    // All versions share the same content hash (content dedup).
    const hashes = new Set(list.map((v) => v.documentHash));
    expect(hashes.size).toBe(1);
  });

  it('handles interleaved unique saves from concurrent callers', async () => {
    const { service, fileId } = await setup();
    // Each save has unique content — all should create.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.createVersion(
          { fileId, kind: 'manual', origin: 'save' },
          makeDoc({ name: `v${i}` } as Partial<Document>),
          { force: true },
        ),
      ),
    );
    const created = results.filter((r) => r !== null);
    expect(created.length).toBe(10);
    const list = await service.listVersions(fileId);
    expect(list.length).toBe(10);
  });

  it('gracefully handles restore of deleted version', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    const entry = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc);
    await service.deleteVersion(entry!.id);
    // Restoring a deleted version returns empty string.
    const json = await service.restoreVersion(entry!.id);
    expect(json).toBe('');
  });

  it('handles delete of non-existent version without throwing', async () => {
    const { service } = await setup();
    await expect(service.deleteVersion('nonexistent')).resolves.toBeUndefined();
  });

  it('prune is safe when no versions exist', async () => {
    const { service, fileId } = await setup();
    const pruned = await service.prune(fileId);
    expect(pruned).toBe(0);
  });

  it('refuses to prune named/pinned versions even if over limit', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    // Create named + pinned versions.
    await service.createNamedCheckpoint(fileId, doc, 'Protected 1');
    await service.createNamedCheckpoint(fileId, doc, 'Protected 2');
    const auto = await service.createVersion(
      { fileId, kind: 'auto', origin: 'autosave' },
      makeDoc({ name: 'auto' } as Partial<Document>),
      { force: true },
    );
    await service.pinVersion(auto!.id, true);

    // Prune should not touch named or pinned versions.
    await service.prune(fileId);
    const list = await service.listVersions(fileId);
    expect(list.some((v) => v.name === 'Protected 1')).toBe(true);
    expect(list.some((v) => v.name === 'Protected 2')).toBe(true);
    expect(list.some((v) => v.pinned)).toBe(true);
  });

  it('compares versions with empty/missing JSON gracefully', async () => {
    const { service } = await setup();
    const diff = await service.compareVersions('nonexistent-a', 'nonexistent-b');
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
  });

  it('handles a platform that throws on createVersion', async () => {
    const { service, fileId } = await setup();
    // Mock the platform to throw.
    const original = service.platform.createVersion;
    service.platform.createVersion = vi.fn().mockRejectedValue(new Error('disk full'));
    await expect(
      service.createVersion({ fileId, kind: 'manual', origin: 'save' }, makeDoc()),
    ).rejects.toThrow('disk full');
    // Restore.
    service.platform.createVersion = original;
  });

  it('maintains correct ref counts through create/delete cycles', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    // Create two versions with same content.
    const v1 = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc, {
      force: true,
    });
    const v2 = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc, {
      force: true,
    });
    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();

    // Delete v1 — content should survive via v2's ref.
    await service.deleteVersion(v1!.id);
    const json = await service.restoreVersion(v2!.id);
    expect(json).toContain('"id":"doc-1"');

    // Delete v2 — content garbage-collected.
    await service.deleteVersion(v2!.id);
    const empty = await service.restoreVersion(v2!.id);
    expect(empty).toBe('');
  });

  it('prune handles the boundary: exactly at limit', async () => {
    const { service, fileId } = await setup();
    // Create exactly maxAutoVersions auto versions.
    for (let i = 0; i < 5; i++) {
      await service.createVersion(
        { fileId, kind: 'auto', origin: 'autosave' },
        makeDoc({ name: `v${i}` } as Partial<Document>),
        { force: true },
      );
    }
    // At limit — no pruning should occur.
    const pruned = await service.prune(fileId);
    expect(pruned).toBe(0);
    const list = await service.listVersions(fileId);
    expect(list.length).toBe(5);
  });

  it('prune removes exactly the overflow', async () => {
    const { service, fileId } = await setup();
    // Create 8 auto versions (limit is 5).
    for (let i = 0; i < 8; i++) {
      await service.createVersion(
        { fileId, kind: 'auto', origin: 'autosave' },
        makeDoc({ name: `v${i}` } as Partial<Document>),
        { force: true },
      );
    }
    const pruned = await service.prune(fileId);
    expect(pruned).toBe(3); // 8 - 5 = 3
    const list = await service.listVersions(fileId);
    expect(list.length).toBe(5);
  });
});
