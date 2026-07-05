import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createMemoryPlatform, makeFileEntry, makeProject } from '../memory';
import { createWebPlatform } from '../web';
import type { Platform } from '../platform';
import { DRAFTS_ID, type FileEntry, type Project } from '../types';

async function testPlatform(name: string, factory: () => Promise<Platform>) {
  describe(name, () => {
    describe('folders', () => {
      it('creates, lists, renames, and deletes folders', async () => {
        const p = await factory();
        const proj = await p.createProject('Test');

        const f1 = await p.createFolder(proj.id, 'Folder 1');
        expect(f1.name).toBe('Folder 1');
        expect(f1.projectId).toBe(proj.id);

        const f2 = await p.createFolder(proj.id, 'Folder 2', f1.id);
        expect(f2.parentId).toBe(f1.id);

        let folders = await p.listFolders(proj.id);
        expect(folders.length).toBe(2);

        await p.renameFolder(f1.id, 'Renamed');
        folders = await p.listFolders(proj.id);
        expect(folders.find((f) => f.id === f1.id)?.name).toBe('Renamed');

        await p.moveFileToFolder('some-file-id', f1.id); // no-op if file doesn't exist

        await p.deleteFolder(f2.id);
        folders = await p.listFolders(proj.id);
        expect(folders.length).toBe(1);
      });
    });

    describe('collections', () => {
      it('creates, updates, deletes collections and manages entries', async () => {
        const p = await factory();
        const file = makeFileEntry({ id: 'f1', name: 'design' });
        await p.upsertFile(file, '{}');

        const c1 = await p.createCollection('My Collection', {
          description: 'test collection',
          color: '#ff0000',
        });
        expect(c1.name).toBe('My Collection');

        let collections = await p.listCollections();
        expect(collections.length).toBe(1);

        await p.updateCollection(c1.id, { name: 'Updated' });
        collections = await p.listCollections();
        expect(collections.find((c) => c.id === c1.id)?.name).toBe('Updated');

        await p.addFileToCollection(c1.id, 'f1');
        let files = await p.listCollectionFiles(c1.id);
        expect(files.length).toBe(1);
        expect(files[0].id).toBe('f1');

        await p.removeFileFromCollection(c1.id, 'f1');
        files = await p.listCollectionFiles(c1.id);
        expect(files.length).toBe(0);

        await p.deleteCollection(c1.id);
        collections = await p.listCollections();
        expect(collections.length).toBe(0);
      });
    });

    describe('workspaces', () => {
      it('creates, renames, deletes workspaces and moves projects', async () => {
        const p = await factory();
        let workspaces = await p.listWorkspaces();
        // memory auto-creates a personal workspace
        expect(workspaces.length).toBeGreaterThanOrEqual(1);

        const ws = await p.createWorkspace('Team WS', 'team');
        expect(ws.name).toBe('Team WS');
        expect(ws.kind).toBe('team');

        workspaces = await p.listWorkspaces();
        expect(workspaces.length).toBeGreaterThanOrEqual(2);

        await p.renameWorkspace(ws.id, 'Renamed WS');
        workspaces = await p.listWorkspaces();
        expect(workspaces.find((w) => w.id === ws.id)?.name).toBe('Renamed WS');

        const proj = await p.createProject('Test Project');
        await p.moveProjectToWorkspace(proj.id, ws.id);

        await p.deleteWorkspace(ws.id);
        workspaces = await p.listWorkspaces();
        expect(workspaces.find((w) => w.id === ws.id)).toBeUndefined();
      });
    });

    describe('libraries', () => {
      it('creates, lists, enables, and deletes libraries', async () => {
        const p = await factory();
        const ws = (await p.listWorkspaces())[0];

        const lib = await p.createLibrary(ws.id, 'Design System', 'components');
        expect(lib.name).toBe('Design System');

        let libraries = await p.listLibraries(ws.id);
        expect(libraries.length).toBe(1);

        await p.enableLibrary(lib.id, false);
        libraries = await p.listLibraries(ws.id);
        expect(libraries.find((l) => l.id === lib.id)?.enabled).toBe(false);

        await p.deleteLibrary(lib.id);
        libraries = await p.listLibraries(ws.id);
        expect(libraries.length).toBe(0);
      });
    });

    describe('templates', () => {
      it('creates, searches, and deletes templates', async () => {
        const p = await factory();
        const file = makeFileEntry({ id: 'f1', name: 'design' });
        await p.upsertFile(file, JSON.stringify({ name: 'design' }));

        const tpl = await p.createTemplateFromFile('f1', 'My Template', 'general');
        expect(tpl.name).toBe('My Template');
        expect(tpl.category).toBe('general');

        let templates = await p.listTemplates();
        expect(templates.length).toBe(1);

        const found = await p.searchTemplates('template');
        expect(found.length).toBe(1);

        await p.deleteTemplate(tpl.id);
        templates = await p.listTemplates();
        expect(templates.length).toBe(0);
      });
    });

    describe('assets', () => {
      it('imports, lists, searches, and deletes assets', async () => {
        const p = await factory();
        const ws = (await p.listWorkspaces())[0];

        const asset = await p.importAsset(
          ws.id,
          'logo.png',
          new Uint8Array([1, 2, 3]),
          'image/png',
        );
        expect(asset.name).toBe('logo.png');

        let assets = await p.listAssets(ws.id);
        expect(assets.length).toBe(1);

        const found = await p.searchAssets('logo');
        expect(found.length).toBe(1);

        await p.deleteAsset(asset.id);
        assets = await p.listAssets(ws.id);
        expect(assets.length).toBe(0);
      });

      it('manages asset folders', async () => {
        const p = await factory();
        const ws = (await p.listWorkspaces())[0];

        const folder = await p.createAssetFolder(ws.id, 'Icons');
        expect(folder.name).toBe('Icons');

        await p.deleteAssetFolder(folder.id);
      });
    });

    describe('versions', () => {
      it('saves, lists, restores, and deletes versions', async () => {
        const p = await factory();
        const file = makeFileEntry({ id: 'f1', name: 'design' });
        await p.upsertFile(file, JSON.stringify({ name: 'design' }));

        const v1 = await p.saveVersion('f1', 'First version', 'Initial design');
        expect(v1.name).toBe('First version');

        const v2 = await p.saveVersion('f1', 'Second version', 'Updated design');
        expect(v2.name).toBe('Second version');

        let versions = await p.listVersions('f1');
        expect(versions.length).toBe(2);

        const restored = await p.restoreVersion('f1', v1.id);
        expect(typeof restored).toBe('string');

        await p.deleteVersionInfo(v2.id);
        versions = await p.listVersions('f1');
        expect(versions.length).toBe(1);
      });

      it('manages branches', async () => {
        const p = await factory();

        let branches = await p.listBranches('f1');
        expect(Array.isArray(branches)).toBe(true);

        const branch = await p.createBranch('f1', 'experiment');
        expect(branch.name).toBe('experiment');

        branches = await p.listBranches('f1');
        expect(branches.length).toBe(1);
      });
    });

    describe('permissions', () => {
      it('sets and lists permissions', async () => {
        const p = await factory();
        await p.setPermission('f1', 'editor');
        const perms = await p.listPermissions('f1');
        expect(perms.length).toBe(1);
        expect(perms[0].role).toBe('editor');
      });
    });

    describe('activity', () => {
      it('records and lists activity', async () => {
        const p = await factory();
        const ws = (await p.listWorkspaces())[0];

        await p.recordActivity({
          workspaceId: ws.id,
          fileId: 'f1',
          type: 'file_created',
        });

        const events = await p.listActivity(ws.id);
        expect(events.length).toBe(1);
        expect(events[0].type).toBe('file_created');
      });
    });

    describe('tags', () => {
      it('creates, renames, deletes tags and manages file tags', async () => {
        const p = await factory();
        const ws = (await p.listWorkspaces())[0];

        const tag = await p.createTag(ws.id, 'production', '#ff0000');
        expect(tag.name).toBe('production');

        let tags = await p.listTags(ws.id);
        expect(tags.length).toBe(1);

        await p.addFileTag('f1', tag.id);
        let fileTags = await p.listFileTags('f1');
        expect(fileTags.length).toBe(1);

        await p.removeFileTag('f1', tag.id);
        fileTags = await p.listFileTags('f1');
        expect(fileTags.length).toBe(0);

        await p.deleteTag(tag.id);
        tags = await p.listTags(ws.id);
        expect(tags.length).toBe(0);
      });
    });

    describe('saved searches', () => {
      it('creates, lists, and deletes saved searches', async () => {
        const p = await factory();
        const saved = await p.createSavedSearch('Recent images', 'image', ['image'], []);
        expect(saved.name).toBe('Recent images');

        let searches = await p.listSavedSearches();
        expect(searches.length).toBe(1);

        await p.deleteSavedSearch(saved.id);
        searches = await p.listSavedSearches();
        expect(searches.length).toBe(0);
      });
    });
  });
}

testPlatform('memory platform', async () => {
  const p = createMemoryPlatform();
  return p;
});

testPlatform('web platform', async () => {
  const p = await createWebPlatform();
  return p;
});
