import { describe, expect, it } from 'vitest';
import { upsertPreservingMeta } from './filePersist';
import { createMemoryPlatform, makeFileEntry } from './memory';

const sampleJson = (name: string) =>
  JSON.stringify({ name, formatVersion: '1.6', rootChildren: [], nodes: {} });

describe('upsertPreservingMeta', () => {
  it('preserves openedAt, pinned, favoritedAt, and projectId across save', async () => {
    const p = createMemoryPlatform();
    const project = await p.createProject('Proj');
    await p.upsertFile(
      makeFileEntry({
        id: 'f1',
        name: 'Design',
        projectId: project.id,
        openedAt: 1111,
        pinned: true,
        favoritedAt: 2222,
      }),
      sampleJson('Design'),
    );

    await upsertPreservingMeta(p, 'f1', 'Design Renamed', sampleJson('Design Renamed'));

    const got = await p.getFile('f1');
    expect(got?.name).toBe('Design Renamed');
    expect(got?.openedAt).toBe(1111);
    expect(got?.pinned).toBe(true);
    expect(got?.favoritedAt).toBe(2222);
    expect(got?.projectId).toBe(project.id);
    expect(got?.updatedAt).toBeGreaterThan(0);
  });

  it('creates a new entry when the file does not exist yet', async () => {
    const p = createMemoryPlatform();
    await upsertPreservingMeta(p, 'new', 'Untitled', sampleJson('Untitled'));
    const got = await p.getFile('new');
    expect(got?.name).toBe('Untitled');
    expect(got?.openedAt).toBe(0);
    expect(got?.pinned).toBe(false);
  });
});
