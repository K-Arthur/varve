// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createWebPlatform } from '../web';

describe('web platform', () => {
  it('creates and lists folders', async () => {
    const p = await createWebPlatform();
    const proj = await p.createProject('Test');
    const f1 = await p.createFolder(proj.id, 'Folder 1');
    expect(f1.name).toBe('Folder 1');
    const folders = await p.listFolders(proj.id);
    expect(folders.length).toBe(1);
  });

  it('creates collections', async () => {
    const p = await createWebPlatform();
    const c = await p.createCollection('Test', {});
    expect(c.name).toBe('Test');
    const list = await p.listCollections();
    expect(list.length).toBe(1);
  });

  it('works with workspaces', async () => {
    const p = await createWebPlatform();
    const ws = await p.createWorkspace('Test', 'team');
    expect(ws.name).toBe('Test');
    const list = await p.listWorkspaces();
    expect(list.length).toBe(1);
  });

  it('manages libraries', async () => {
    const p = await createWebPlatform();
    const ws = await p.createWorkspace('WS', 'personal');
    const lib = await p.createLibrary(ws.id, 'Lib', 'components');
    expect(lib.name).toBe('Lib');
  });

  it('creates templates', async () => {
    const p = await createWebPlatform();
    const mf = { id: 'f1', name: 'test', kind: 'strata' as const, projectId: null, createdAt: 0, updatedAt: 0, openedAt: 0, size: 2, pinned: false, trashedAt: null, ordering: '', contentHash: 'h' };
    await p.upsertFile(mf, '{}');
    const t = await p.createTemplateFromFile('f1', 'Tpl', 'general');
    expect(t.name).toBe('Tpl');
  });

  it('imports and deletes assets', async () => {
    const p = await createWebPlatform();
    const ws = await p.createWorkspace('WS', 'personal');
    const a = await p.importAsset(ws.id, 'img.png', new Uint8Array([1]), 'image/png');
    expect(a.name).toBe('img.png');
    await p.deleteAsset(a.id);
  });

  it('manages versions', async () => {
    const p = await createWebPlatform();
    const mf = { id: 'f1', name: 'test', kind: 'strata' as const, projectId: null, createdAt: 0, updatedAt: 0, openedAt: 0, size: 2, pinned: false, trashedAt: null, ordering: '', contentHash: 'h' };
    await p.upsertFile(mf, '{}');
    const v = await p.saveVersion('f1', 'v1', 'desc');
    expect(v.name).toBe('v1');
    const list = await p.listVersions('f1');
    expect(list.length).toBe(1);
  });

  it('manages permissions', async () => {
    const p = await createWebPlatform();
    await p.setPermission('f1', 'editor');
    const perms = await p.listPermissions('f1');
    expect(perms.length).toBe(1);
  });

  it('records activity', async () => {
    const p = await createWebPlatform();
    const ws = await p.createWorkspace('WS', 'personal');
    await p.recordActivity({ workspaceId: ws.id, fileId: 'f1', type: 'file_created' });
    const events = await p.listActivity(ws.id);
    expect(events.length).toBe(1);
  });

  it('manages tags', async () => {
    const p = await createWebPlatform();
    const ws = await p.createWorkspace('WS', 'personal');
    const tag = await p.createTag(ws.id, 'hot', 'red');
    expect(tag.name).toBe('hot');
    await p.addFileTag('f1', tag.id);
    const tags = await p.listFileTags('f1');
    expect(tags.length).toBe(1);
  });

  it('manages saved searches', async () => {
    const p = await createWebPlatform();
    const s = await p.createSavedSearch('Recent', 'query', ['strata'], []);
    expect(s.name).toBe('Recent');
    const list = await p.listSavedSearches();
    expect(list.length).toBe(1);
  });

  it('manages branches', async () => {
    const p = await createWebPlatform();
    const b = await p.createBranch('f1', 'experiment');
    expect(b.name).toBe('experiment');
  });

  it('manages asset folders', async () => {
    const p = await createWebPlatform();
    const ws = await p.createWorkspace('WS', 'personal');
    const f = await p.createAssetFolder(ws.id, 'Icons');
    expect(f.name).toBe('Icons');
  });
});
