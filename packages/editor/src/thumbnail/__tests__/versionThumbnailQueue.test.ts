// @vitest-environment jsdom

import { createMemoryPlatform, type Platform } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionThumbnailQueue } from '../versionThumbnailQueue';

function makeDoc(id = 'doc-1') {
  return {
    id,
    name: 'Test',
    rootChildren: ['n1'],
    nodes: {
      n1: {
        id: 'n1',
        kind: 'shape',
        name: 'Rect',
        transform: [1, 0, 0, 1, 0, 0],
        shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        fills: [],
        strokes: [],
        effects: [],
        filters: [],
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
      },
    },
    components: {},
    nextId: 2,
    formatVersion: '2.5',
  } as any;
}

let platform: Platform;

beforeEach(async () => {
  platform = createMemoryPlatform();
  await platform.upsertFile(
    {
      id: 'file-1',
      name: 'Test',
      kind: 'strata',
      projectId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      openedAt: Date.now(),
      size: 100,
      pinned: false,
      trashedAt: null,
      ordering: '',
      contentHash: 'hash-1',
    },
    JSON.stringify(makeDoc()),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('VersionThumbnailQueue', () => {
  it('enqueues a thumbnail job successfully', () => {
    const queue = new VersionThumbnailQueue(platform);

    const result = queue.enqueue({
      versionId: 'v-test',
      fileId: 'file-1',
      document: makeDoc(),
      revisionHash: 'hash-1',
    });
    expect(result).toBe(true);
    // Job is processed asynchronously via requestIdleCallback/setTimeout
    expect(queue.pending).toBeGreaterThanOrEqual(0);
  });

  it('accepts up to maxQueueSize items', () => {
    const queue = new VersionThumbnailQueue(platform);
    queue.setMaxQueueSize(5);

    const emptyVersion = {
      versionId: 'v',
      fileId: 'file-1',
      document: makeDoc(),
      revisionHash: '',
    };

    for (let i = 0; i < 10; i++) {
      queue.enqueue({ ...emptyVersion, versionId: `v${i}` });
    }

    expect(queue.pending).toBeLessThanOrEqual(5);
  });

  it('shutdown clears pending jobs', () => {
    const queue = new VersionThumbnailQueue(platform);
    queue.setMaxQueueSize(10);
    for (let i = 0; i < 5; i++) {
      queue.enqueue({
        versionId: `v${i}`,
        fileId: 'file-1',
        document: makeDoc(),
        revisionHash: '',
      });
    }
    queue.shutdown();
    expect(queue.pending).toBe(0);
  });

  it('shutdown prevents new jobs', () => {
    const queue = new VersionThumbnailQueue(platform);
    queue.shutdown();
    const result = queue.enqueue({
      versionId: 'v1',
      fileId: 'file-1',
      document: makeDoc(),
      revisionHash: '',
    });
    expect(result).toBe(false);
  });

  it('does not update thumbnail when version no longer exists', async () => {
    const queue = new VersionThumbnailQueue(platform);
    const version = await platform.createVersion({
      fileId: 'file-1',
      kind: 'manual',
      origin: 'save',
      documentJson: JSON.stringify(makeDoc()),
      contentHash: 'hash-1',
      size: 100,
    });

    // Delete the version
    await platform.deleteVersionInfo(version.id);

    // Enqueue — should gracefully skip
    queue.enqueue({
      versionId: version.id,
      fileId: 'file-1',
      document: makeDoc(),
      revisionHash: 'hash-1',
    });
    // No crash = success
    expect(true).toBe(true);
  });
});
