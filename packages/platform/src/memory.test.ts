import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryPlatform, makeFileEntry, makeProject } from './memory';
import { contentHash, defaultViewState, uuid } from './pure';
import type { FileEntry } from './types';

function sampleJson(name: string): string {
  return JSON.stringify({ id: 'n1', name, rootChildren: [], nodes: {}, components: {}, nextId: 1 });
}

describe('createMemoryPlatform — file lifecycle', () => {
  it('upserts and reads back a document', async () => {
    const p = createMemoryPlatform();
    const entry = makeFileEntry({ id: uuid(), name: 'Logo' });
    const json = sampleJson('Logo');
    await p.upsertFile(entry, json);

    const files = await p.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('Logo');
    expect((await p.readFile(entry.id))?.length ?? 0).toBeGreaterThan(0);
  });

  it('records contentHash + size on upsert', async () => {
    const p = createMemoryPlatform();
    const json = sampleJson('A');
    await p.upsertFile(makeFileEntry({ id: 'f1', name: 'A' }), json);
    const got = await p.getFile('f1');
    expect(got?.contentHash).toBe(contentHash(json));
    expect(got?.size).toBe(json.length);
  });

  it('touch updates openedAt', async () => {
    const p = createMemoryPlatform();
    await p.upsertFile(makeFileEntry({ id: 'f1', name: 'A' }), sampleJson('A'));
    await p.touchFile('f1', 1234);
    expect((await p.getFile('f1'))?.openedAt).toBe(1234);
  });

  it('rename + pin + move project', async () => {
    const p = createMemoryPlatform();
    await p.upsertFile(makeFileEntry({ id: 'f1', name: 'A' }), sampleJson('A'));
    await p.renameFile('f1', 'Renamed');
    await p.setPinned('f1', true);
    await p.moveToProject('f1', 'proj-1');
    const got = await p.getFile('f1');
    expect(got?.name).toBe('Renamed');
    expect(got?.pinned).toBe(true);
    expect(got?.projectId).toBe('proj-1');
  });

  it('trash → listTrashedFiles → restore', async () => {
    const p = createMemoryPlatform();
    await p.upsertFile(makeFileEntry({ id: 'f1', name: 'A' }), sampleJson('A'));
    await p.trashFile('f1');
    expect(await p.listFiles()).toHaveLength(0);
    expect(await p.listTrashedFiles()).toHaveLength(1);
    await p.restoreFile('f1');
    expect(await p.listFiles()).toHaveLength(1);
    expect(await p.listTrashedFiles()).toHaveLength(0);
  });

  it('purge permanently deletes', async () => {
    const p = createMemoryPlatform();
    await p.upsertFile(makeFileEntry({ id: 'f1', name: 'A' }), sampleJson('A'));
    await p.purgeFile('f1');
    expect(await p.getFile('f1')).toBeUndefined();
    expect(await p.readFile('f1')).toBeUndefined();
  });
});

describe('createMemoryPlatform — projects', () => {
  it('creates, lists, renames, pins, deletes', async () => {
    const p = createMemoryPlatform();
    const proj = await p.createProject('Brand');
    await p.createProject('Marketing');
    expect(await p.listProjects()).toHaveLength(2);

    await p.renameProject(proj.id, 'Brand 2026');
    await p.setProjectPinned(proj.id, true);
    const got = (await p.listProjects()).find((x) => x.id === proj.id);
    expect(got?.name).toBe('Brand 2026');
    expect(got?.pinned).toBe(true);

    await p.deleteProject(proj.id);
    expect(await p.listProjects()).toHaveLength(1);
  });

  it('unfiles members when a project is deleted', async () => {
    const p = createMemoryPlatform();
    const proj = await p.createProject('P');
    await p.upsertFile(makeFileEntry({ id: 'f1', name: 'A', projectId: proj.id }), sampleJson('A'));
    await p.deleteProject(proj.id);
    expect((await p.getFile('f1'))?.projectId).toBeNull();
  });
});

describe('createMemoryPlatform — thumbnails', () => {
  it('stores + reads by content hash', async () => {
    const p = createMemoryPlatform();
    await p.putThumbnail({
      hash: 'h1',
      dataUrl: 'data:...',
      width: 200,
      height: 150,
      createdAt: 1,
    });
    expect(await p.getThumbnail('h1')).toBe('data:...');
  });

  it('evicts oldest beyond keepCount', async () => {
    const p = createMemoryPlatform();
    await p.putThumbnail({ hash: '1', dataUrl: 'a', width: 1, height: 1, createdAt: 1 });
    await p.putThumbnail({ hash: '2', dataUrl: 'b', width: 1, height: 1, createdAt: 2 });
    await p.putThumbnail({ hash: '3', dataUrl: 'c', width: 1, height: 1, createdAt: 3 });
    const evicted = await p.evictThumbnails(1);
    expect(evicted).toBe(2);
    expect(await p.getThumbnail('1')).toBeUndefined();
    expect(await p.getThumbnail('2')).toBeUndefined();
    expect(await p.getThumbnail('3')).toBe('c');
  });
});

describe('createMemoryPlatform — view state', () => {
  it('defaults then round-trips', async () => {
    const p = createMemoryPlatform();
    expect(await p.getViewState()).toEqual(defaultViewState());
    const next = { ...defaultViewState(), view: 'list' as const, sidebarCollapsed: true };
    await p.setViewState(next);
    expect((await p.getViewState()).view).toBe('list');
    expect((await p.getViewState()).sidebarCollapsed).toBe(true);
  });
});

describe('createMemoryPlatform — native dialogs (no-op)', () => {
  beforeEach(() => {
    // Emphasize that memory is the offline/test backend.
  });

  it('openDocumentFromDisk returns null (cancelled)', async () => {
    const p = createMemoryPlatform();
    expect(await p.openDocumentFromDisk()).toBeNull();
  });

  it('importDocumentFromDisk returns unsupported=false, result=null', async () => {
    const p = createMemoryPlatform();
    const r = await p.importDocumentFromDisk(['.strata']);
    expect(r.result).toBeNull();
    expect(r.unsupported).toBe(false);
  });

  it('saveDocumentToDisk returns null', async () => {
    const p = createMemoryPlatform();
    expect(await p.saveDocumentToDisk('x', '{}')).toBeNull();
  });

  it('revealInFileManager resolves without throwing', async () => {
    const p = createMemoryPlatform();
    await expect(p.revealInFileManager('/x')).resolves.toBeUndefined();
  });

  it('fileManagerLabel returns a non-empty string', async () => {
    const p = createMemoryPlatform();
    expect(p.fileManagerLabel().length).toBeGreaterThan(0);
  });
});

describe('makeFileEntry / makeProject helpers', () => {
  it('apply defaults over required fields', () => {
    const e: FileEntry = makeFileEntry({ id: 'x', name: 'n' });
    expect(e.kind).toBe('strata');
    expect(e.pinned).toBe(false);
    expect(e.trashedAt).toBeNull();
  });

  it('makeProject applies defaults', () => {
    const pr = makeProject({ id: 'p', name: 'P' });
    expect(pr.pinned).toBe(false);
    expect(pr.trashedAt).toBeNull();
  });
});
