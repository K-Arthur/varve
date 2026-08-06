/**
 * Baseline tests for the persistent-history architecture (Milestone 1).
 *
 * Captures CURRENT platform version-store behavior so later milestones
 * (snapshot revisions, branch heads, SHA-256 content addressing) can prove
 * they change it deliberately. See
 * docs/audits/history-version-system-map-2026-08-05.md.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryPlatform, makeFileEntry } from '../memory';

const CONTENT = JSON.stringify({ formatVersion: '2.15', nodes: {}, rootChildren: [] });

async function seedFile(p: Awaited<ReturnType<typeof createMemoryPlatform>>, id = 'doc.varve') {
  await p.upsertFile(makeFileEntry({ id, name: id }), CONTENT);
  return id;
}

describe('baseline: version store (memory backend)', () => {
  it('deduplicates identical content by documentHash', async () => {
    const p = createMemoryPlatform();
    const fileId = await seedFile(p);

    const v1 = await p.createVersion({
      fileId,
      contentHash: 'hash-1',
      documentJson: CONTENT,
      kind: 'manual',
      origin: 'save',
      size: CONTENT.length,
    });
    const v2 = await p.createVersion({
      fileId,
      contentHash: 'hash-1',
      documentJson: CONTENT,
      kind: 'manual',
      origin: 'save',
      size: CONTENT.length,
    });
    expect(v1.id).not.toBe(v2.id);
    const versions = await p.listVersions(fileId);
    expect(versions.length).toBe(2);
    expect(await p.restoreVersionById(v1.id)).toBe(CONTENT);
    expect(await p.restoreVersionById(v2.id)).toBe(CONTENT);
  });

  it('versions are flat: no parent lineage exists today', async () => {
    const p = createMemoryPlatform();
    const fileId = await seedFile(p);
    const v = await p.createVersion({
      fileId,
      contentHash: 'hash-2',
      documentJson: CONTENT,
      kind: 'checkpoint',
      origin: 'checkpoint',
      size: CONTENT.length,
    });
    const record = (await p.listVersions(fileId))[0]!;
    expect(record.id).toBe(v.id);
    expect(record.kind).toBe('checkpoint');
    expect('parentId' in record).toBe(false);
    expect('headRevisionId' in record).toBe(false);
  });

  it('prune keeps named and pinned versions and collects orphaned content', async () => {
    const p = createMemoryPlatform();
    const fileId = await seedFile(p);
    const named = await p.createVersion({
      fileId,
      contentHash: 'named-hash',
      documentJson: CONTENT,
      kind: 'named',
      origin: 'checkpoint',
      size: CONTENT.length,
    });
    await p.createVersion({
      fileId,
      contentHash: 'auto-1',
      documentJson: CONTENT,
      kind: 'auto',
      origin: 'autosave',
      size: CONTENT.length,
    });
    await p.createVersion({
      fileId,
      contentHash: 'auto-2',
      documentJson: CONTENT,
      kind: 'auto',
      origin: 'autosave',
      size: CONTENT.length,
    });
    const removed = await p.pruneVersions(fileId, 1);
    expect(removed).toBe(1);
    const remaining = await p.listVersions(fileId);
    expect(remaining.length).toBe(2);
    expect(remaining.some((v) => v.id === named.id)).toBe(true);
    const stats = await p.getVersionStats(fileId);
    expect(stats.namedVersions).toBe(1);
  });
});
