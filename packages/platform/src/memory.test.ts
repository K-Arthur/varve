import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryPlatform, makeFileEntry, makeProject } from './memory';
import { contentHash, defaultViewState, uuid } from './pure';
import type { CreateVersionInput, FileEntry } from './types';

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

  it('persists thumbnail preference on the file entry (all source kinds)', async () => {
    const p = createMemoryPlatform();
    const docJson = JSON.stringify({ nodes: {} });
    await p.upsertFile(makeFileEntry({ id: 'f1', name: 'Design' }), docJson);
    const region = { type: 'region', region: { x: 10, y: 20, w: 300, h: 200 } } as const;
    await p.setThumbnailPreference('f1', region);
    const after = await p.getFile('f1');
    expect(after?.thumbnailPreference).toEqual(region);
    // Automatic round-trips too, and unknown files are a silent no-op.
    await p.setThumbnailPreference('f1', { type: 'automatic' });
    expect((await p.getFile('f1'))?.thumbnailPreference).toEqual({ type: 'automatic' });
    await p.setThumbnailPreference('does-not-exist', { type: 'page', pageId: 'p' });
    expect(await p.getFile('does-not-exist')).toBeUndefined();
  });

  it('thumbnail preference survives upsertFile of new document bytes', async () => {
    const p = createMemoryPlatform();
    await p.upsertFile(makeFileEntry({ id: 'f1', name: 'Design' }), 'v1');
    await p.setThumbnailPreference('f1', { type: 'frame', nodeId: 'n1' });
    const entry = await p.getFile('f1');
    if (!entry) throw new Error('missing file');
    await p.upsertFile(entry, 'v2');
    expect((await p.getFile('f1'))?.thumbnailPreference).toEqual({ type: 'frame', nodeId: 'n1' });
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

describe('saveBinaryFile', () => {
  it('returns a memory:// path for a binary buffer', async () => {
    const p = createMemoryPlatform();
    const data = new Uint8Array([1, 2, 3, 4]);
    const path = await p.saveBinaryFile('test.pdf', data, 'application/pdf', '.pdf');
    expect(path).toMatch(/^memory:\/\/test/);
  });

  it('accepts different extensions and mime types', async () => {
    const p = createMemoryPlatform();
    const png = new Uint8Array([137, 80, 78, 71]);
    const svg = new Uint8Array([60, 115, 118, 103]);
    const pngPath = await p.saveBinaryFile('icon@2x', png, 'image/png', '.png');
    const svgPath = await p.saveBinaryFile('icon', svg, 'image/svg+xml', '.svg');
    expect(pngPath).toMatch(/^memory:\/\//);
    expect(svgPath).toMatch(/^memory:\/\//);
  });
});

describe('createMemoryPlatform — tags', () => {
  it('creates and lists tags by workspace', async () => {
    const p = createMemoryPlatform();
    const workspaces = await p.listWorkspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error('no workspace');
    const tag = await p.createTag(ws.id, 'Important', '#ff0000');
    expect(tag.name).toBe('Important');
    expect(tag.color).toBe('#ff0000');

    const tags = await p.listTags(ws.id);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.id).toBe(tag.id);
  });

  it('renames a tag', async () => {
    const p = createMemoryPlatform();
    const workspaces = await p.listWorkspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error('no workspace');
    const tag = await p.createTag(ws.id, 'Old Name');
    await p.renameTag(tag.id, 'New Name');
    const tags = await p.listTags(ws.id);
    expect(tags[0]?.name).toBe('New Name');
  });

  it('deletes a tag and removes file associations', async () => {
    const p = createMemoryPlatform();
    const workspaces = await p.listWorkspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error('no workspace');
    const tag = await p.createTag(ws.id, 'ToDelete');
    const entry = makeFileEntry({ id: 'f1', name: 'File1' });
    await p.upsertFile(entry, sampleJson('File1'));
    await p.addFileTag('f1', tag.id);

    await p.deleteTag(tag.id);
    const tags = await p.listTags(ws.id);
    expect(tags).toHaveLength(0);
    const fileTags = await p.listFileTags('f1');
    expect(fileTags).toHaveLength(0);
  });

  it('adds and removes file tags', async () => {
    const p = createMemoryPlatform();
    const workspaces = await p.listWorkspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error('no workspace');
    const tag1 = await p.createTag(ws.id, 'Tag1');
    const tag2 = await p.createTag(ws.id, 'Tag2');
    const entry = makeFileEntry({ id: 'f1', name: 'File1' });
    await p.upsertFile(entry, sampleJson('File1'));

    await p.addFileTag('f1', tag1.id);
    await p.addFileTag('f1', tag2.id);
    let fileTags = await p.listFileTags('f1');
    expect(fileTags).toHaveLength(2);

    await p.removeFileTag('f1', tag1.id);
    fileTags = await p.listFileTags('f1');
    expect(fileTags).toHaveLength(1);
    expect(fileTags[0]?.name).toBe('Tag2');
  });

  it('does not duplicate file tags', async () => {
    const p = createMemoryPlatform();
    const workspaces = await p.listWorkspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error('no workspace');
    const tag = await p.createTag(ws.id, 'Tag');
    const entry = makeFileEntry({ id: 'f1', name: 'File1' });
    await p.upsertFile(entry, sampleJson('File1'));

    await p.addFileTag('f1', tag.id);
    await p.addFileTag('f1', tag.id);
    const fileTags = await p.listFileTags('f1');
    expect(fileTags).toHaveLength(1);
  });

  it('lists files by tag', async () => {
    const p = createMemoryPlatform();
    const workspaces = await p.listWorkspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error('no workspace');
    const tag = await p.createTag(ws.id, 'Important');
    await p.upsertFile(makeFileEntry({ id: 'f1', name: 'File1' }), sampleJson('File1'));
    await p.upsertFile(makeFileEntry({ id: 'f2', name: 'File2' }), sampleJson('File2'));
    await p.addFileTag('f1', tag.id);

    const taggedFiles = await p.listFilesByTag(tag.id);
    expect(taggedFiles).toHaveLength(1);
    expect(taggedFiles[0]?.name).toBe('File1');
  });
});

describe('createMemoryPlatform — saved searches', () => {
  it('creates and lists saved searches', async () => {
    const p = createMemoryPlatform();
    const search = await p.createSavedSearch('My Search', 'logo', ['strata']);
    expect(search.name).toBe('My Search');
    expect(search.query).toBe('logo');

    const all = await p.listSavedSearches();
    expect(all).toHaveLength(1);
  });

  it('deletes a saved search', async () => {
    const p = createMemoryPlatform();
    const search = await p.createSavedSearch('Temp', 'test');
    await p.deleteSavedSearch(search.id);
    const all = await p.listSavedSearches();
    expect(all).toHaveLength(0);
  });
});

describe('createMemoryPlatform — version history', () => {
  let p: ReturnType<typeof createMemoryPlatform>;
  let fileId: string;

  beforeEach(async () => {
    p = createMemoryPlatform();
    fileId = uuid();
    await p.upsertFile(makeFileEntry({ id: fileId, name: 'Doc' }), '{}');
  });

  function makeInput(overrides: Partial<CreateVersionInput> = {}): CreateVersionInput {
    const json = JSON.stringify({ name: overrides.name ?? 'v', nodes: {} });
    return {
      fileId,
      kind: 'auto',
      origin: 'autosave',
      documentJson: json,
      contentHash: contentHash(json),
      size: json.length,
      ...overrides,
    };
  }

  it('createVersion stores content-addressed document', async () => {
    const entry = await p.createVersion(makeInput());
    expect(entry.id).toBeTruthy();
    expect(entry.fileId).toBe(fileId);
    expect(entry.size).toBeGreaterThan(0);
    expect(entry.pinned).toBe(false);
    const json = await p.restoreVersionById(entry.id);
    expect(json).toContain('"nodes"');
  });

  it('dedups identical content across versions', async () => {
    const input = makeInput();
    await p.createVersion(input);
    await p.createVersion({
      ...input,
      contentHash: input.contentHash,
      documentJson: input.documentJson,
    });
    const list = await p.listVersions(fileId);
    expect(list).toHaveLength(2);
    expect(list[0]!.documentHash).toBe(list[1]!.documentHash);
  });

  it('renameVersion updates name and description', async () => {
    const entry = await p.createVersion(makeInput());
    await p.renameVersion(entry.id, 'Final', 'Approved');
    const list = await p.listVersions(fileId);
    expect(list[0]!.name).toBe('Final');
    expect(list[0]!.description).toBe('Approved');
  });

  it('pinVersion protects from prune', async () => {
    const named = await p.createVersion(makeInput({ kind: 'named', name: 'Keep' }));
    await p.pinVersion(named.id, true);
    const removed = await p.pruneVersions(fileId, 0);
    expect(removed).toBe(0);
    const list = await p.listVersions(fileId);
    expect(list[0]!.id).toBe(named.id);
  });

  it('pruneVersions removes auto beyond limit, preserves named', async () => {
    await p.createVersion(makeInput({ kind: 'named', name: 'Named' }));
    for (let i = 0; i < 5; i++) {
      await p.createVersion(makeInput({ name: `auto${i}` }));
    }
    const removed = await p.pruneVersions(fileId, 2);
    expect(removed).toBe(3);
    const list = await p.listVersions(fileId);
    expect(list.some((v) => v.name === 'Named')).toBe(true);
    const autoCount = list.filter((v) => v.kind === 'auto').length;
    expect(autoCount).toBe(2);
  });

  it('getVersionStats returns correct counts', async () => {
    await p.createVersion(makeInput({ kind: 'named', name: 'N' }));
    await p.createVersion(makeInput());
    const stats = await p.getVersionStats(fileId);
    expect(stats.totalVersions).toBe(2);
    expect(stats.namedVersions).toBe(1);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  it('garbage-collects unreferenced content on prune', async () => {
    const e1 = await p.createVersion(makeInput({ name: 'a' }));
    await p.pruneVersions(fileId, 0);
    const json = await p.restoreVersionById(e1.id);
    expect(json).toBe('');
  });
});
