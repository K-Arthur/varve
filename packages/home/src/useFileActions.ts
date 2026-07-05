import type { FileEntry, Platform, Project } from '@strata/platform';
import { uuid } from '@strata/platform';
import { useCallback } from 'react';

export interface FileActions {
  rename: (id: string, name: string) => Promise<void>;
  duplicate: (entry: FileEntry, docJson: string) => Promise<void>;
  trash: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;
  togglePin: (entry: FileEntry) => Promise<void>;
  toggleFavorite: (entry: FileEntry) => Promise<void>;
  moveToProject: (id: string, projectId: string | null) => Promise<void>;
  createProject: (name: string, workspaceId?: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
}

export function useFileActions(platform: Platform, onRefresh: () => void): FileActions {
  const rename = useCallback(
    async (id: string, name: string) => {
      await platform.renameFile(id, name);
      onRefresh();
    },
    [platform, onRefresh],
  );

  const duplicate = useCallback(
    async (entry: FileEntry, docJson: string) => {
      const newEntry: FileEntry = {
        id: uuid(),
        name: `${entry.name} (copy)`,
        kind: entry.kind,
        projectId: entry.projectId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        openedAt: 0,
        size: entry.size,
        pinned: false,
        trashedAt: null,
        ordering: '',
        contentHash: entry.contentHash,
      };
      await platform.upsertFile(newEntry, docJson);
      onRefresh();
    },
    [platform, onRefresh],
  );

  const trash = useCallback(
    async (id: string) => {
      await platform.trashFile(id);
      onRefresh();
    },
    [platform, onRefresh],
  );

  const restore = useCallback(
    async (id: string) => {
      await platform.restoreFile(id);
      onRefresh();
    },
    [platform, onRefresh],
  );

  const purge = useCallback(
    async (id: string) => {
      await platform.purgeFile(id);
      onRefresh();
    },
    [platform, onRefresh],
  );

  const togglePin = useCallback(
    async (entry: FileEntry) => {
      await platform.setPinned(entry.id, !entry.pinned);
      onRefresh();
    },
    [platform, onRefresh],
  );

  const toggleFavorite = useCallback(
    async (entry: FileEntry) => {
      const isFav = entry.favoritedAt != null && entry.favoritedAt > 0;
      await platform.setFavorited(entry.id, isFav ? null : Date.now());
      onRefresh();
    },
    [platform, onRefresh],
  );

  const moveToProject = useCallback(
    async (id: string, projectId: string | null) => {
      await platform.moveToProject(id, projectId);
      onRefresh();
    },
    [platform, onRefresh],
  );

  const createProject = useCallback(
    async (name: string, workspaceId?: string) => {
      const proj = await platform.createProject(name);
      if (workspaceId) {
        await platform.moveProjectToWorkspace(proj.id, workspaceId);
      }
      onRefresh();
      const updated = await platform
        .listProjects()
        .then((list) => list.find((p) => p.id === proj.id));
      return updated ?? proj;
    },
    [platform, onRefresh],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      await platform.deleteProject(id);
      onRefresh();
    },
    [platform, onRefresh],
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      await platform.renameProject(id, name);
      onRefresh();
    },
    [platform, onRefresh],
  );

  return {
    rename,
    duplicate,
    trash,
    restore,
    purge,
    togglePin,
    toggleFavorite,
    moveToProject,
    createProject,
    deleteProject,
    renameProject,
  };
}
