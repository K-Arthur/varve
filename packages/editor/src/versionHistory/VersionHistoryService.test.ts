// @vitest-environment jsdom

import { createMemoryPlatform } from '@strata/platform';
import type { Document } from '@strata/scene';
import { describe, expect, it } from 'vitest';
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
        name: 'Rect 1',
        transform: [1, 0, 0, 1, 0, 0],
        shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        fills: [{ type: 'solid', color: [255, 0, 0, 255] }],
        strokes: [],
        effects: [],
        filters: [],
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
      } as Document['nodes']['n1'],
    } as Document['nodes'],
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
      openedAt: Date.now(),
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
    maxAutoVersions: 3,
    maxTotalVersions: 10,
  });
  return { platform, fileId, service };
}

describe('VersionHistoryService', () => {
  it('creates a version with content-addressed storage', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    const entry = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc);
    expect(entry).not.toBeNull();
    expect(entry!.fileId).toBe(fileId);
    expect(entry!.kind).toBe('manual');
    expect(entry!.size).toBeGreaterThan(0);
    expect(entry!.documentHash).toBeTruthy();
  });

  it('dedups identical content (skips second create)', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    const first = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc);
    expect(first).not.toBeNull();
    const second = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc);
    expect(second).toBeNull();
    const list = await service.listVersions(fileId);
    expect(list.length).toBe(1);
  });

  it('force creates even with identical content', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc);
    const forced = await service.createVersion(
      { fileId, kind: 'named', name: 'Checkpoint', origin: 'checkpoint' },
      doc,
      { force: true },
    );
    expect(forced).not.toBeNull();
    const list = await service.listVersions(fileId);
    expect(list.length).toBe(2);
  });

  it('restores a version document', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    const entry = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc);
    const json = await service.restoreVersion(entry!.id);
    expect(json).toContain('"id":"doc-1"');
  });

  it('creates named checkpoints', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    const entry = await service.createNamedCheckpoint(fileId, doc, 'Final', 'Approved');
    expect(entry.name).toBe('Final');
    expect(entry.kind).toBe('named');
  });

  it('auto-version respects interval', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    const first = await service.maybeAutoVersion(fileId, doc);
    expect(first).not.toBeNull();
    const second = await service.maybeAutoVersion(fileId, doc);
    expect(second).toBeNull();
  });

  it('deletes a version and garbage-collects content', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    const entry = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc);
    await service.deleteVersion(entry!.id);
    const list = await service.listVersions(fileId);
    expect(list.length).toBe(0);
    const stats = await service.getVersionStats(fileId);
    expect(stats.totalVersions).toBe(0);
  });

  it('deduplicates content across versions (shared storage)', async () => {
    const { service, fileId } = await setup();
    const doc1 = makeDoc();
    const doc2 = makeDoc({ name: 'Test v2' } as Partial<Document>);
    await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc1, {
      force: true,
    });
    await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc2, {
      force: true,
    });
    await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc1, {
      force: true,
    });
    const stats = await service.getVersionStats(fileId);
    expect(stats.totalVersions).toBe(3);
  });

  it('prunes auto versions beyond limit, preserves named', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    await service.createNamedCheckpoint(fileId, doc, 'Keep me');
    for (let i = 0; i < 5; i++) {
      const modified = makeDoc({ name: `v${i}` } as Partial<Document>);
      await service.createVersion({ fileId, kind: 'auto', origin: 'autosave' }, modified, {
        force: true,
      });
    }
    const pruned = await service.prune(fileId);
    expect(pruned).toBeGreaterThan(0);
    const list = await service.listVersions(fileId);
    expect(list.some((v) => v.name === 'Keep me')).toBe(true);
    const autoCount = list.filter((v) => v.kind === 'auto').length;
    expect(autoCount).toBeLessThanOrEqual(3);
  });

  it('compares two versions and reports added/removed/modified', async () => {
    const { service, fileId } = await setup();
    const doc1 = makeDoc();
    const v1 = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc1, {
      force: true,
    });
    const doc2 = makeDoc({
      rootChildren: ['n1', 'n2'],
      nodes: {
        ...doc1.nodes,
        n2: {
          id: 'n2',
          kind: 'shape',
          name: 'Rect 2',
          transform: [1, 0, 0, 1, 50, 50],
          shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          fills: [{ type: 'solid', color: [0, 255, 0, 255] }],
          strokes: [],
          effects: [],
          filters: [],
          opacity: 1,
          blendMode: 'normal',
          visible: true,
          locked: false,
        } as Document['nodes']['n1'],
      } as Document['nodes'],
      nextId: 3,
    } as Partial<Document>);
    const v2 = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc2, {
      force: true,
    });
    const diff = await service.compareVersions(v1!.id, v2!.id);
    expect(diff.added).toContain('n2');
    expect(diff.removed).toEqual([]);
  });

  it('renames a version', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    const entry = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc);
    await service.renameVersion(entry!.id, 'Renamed', 'A note');
    const list = await service.listVersions(fileId);
    expect(list[0].name).toBe('Renamed');
    expect(list[0].description).toBe('A note');
  });

  it('pins and unpins a version', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    const entry = await service.createVersion({ fileId, kind: 'manual', origin: 'save' }, doc);
    await service.pinVersion(entry!.id, true);
    let list = await service.listVersions(fileId);
    expect(list[0].pinned).toBe(true);
    await service.pinVersion(entry!.id, false);
    list = await service.listVersions(fileId);
    expect(list[0].pinned).toBe(false);
  });

  it('getVersionStats returns correct counts', async () => {
    const { service, fileId } = await setup();
    const doc = makeDoc();
    await service.createNamedCheckpoint(fileId, doc, 'Named');
    await service.createVersion({ fileId, kind: 'auto', origin: 'autosave' }, doc, {
      force: true,
    });
    const stats = await service.getVersionStats(fileId);
    expect(stats.totalVersions).toBe(2);
    expect(stats.namedVersions).toBe(1);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });
});
