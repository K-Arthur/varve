/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import {
  createMemoryPlatform,
  defaultViewState,
  type HomeViewState,
  makeFileEntry,
  type Workspace,
} from '@varve/platform';
import { describe, expect, it, vi } from 'vitest';
import { useFileActions } from './useFileActions';
import { useHomeView } from './useHomeView';

function sampleJson(name: string) {
  return JSON.stringify({ id: name, name, rootChildren: [], nodes: {}, components: {}, nextId: 1 });
}

describe('useHomeView — workspace filtering', () => {
  it('keeps a sidebar selection made while the initial load is pending', async () => {
    const platform = createMemoryPlatform();
    let releaseViewState!: (viewState: HomeViewState) => void;
    const pendingViewState = new Promise<HomeViewState>((resolve) => {
      releaseViewState = resolve;
    });
    vi.spyOn(platform, 'getViewState').mockReturnValue(pendingViewState);

    const { result } = renderHook(() => useHomeView(platform));
    act(() => result.current.setSection('assets'));
    releaseViewState(defaultViewState());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state.section).toBe('assets');
  });

  it('defaults to the first personal workspace', async () => {
    const platform = createMemoryPlatform();
    const { result } = renderHook(() => useHomeView(platform));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const active = result.current.workspaces.find((w) => w.id === result.current.activeWorkspaceId);
    expect(active?.kind).toBe('personal');
  });

  it('scopes projects and files to the active workspace', async () => {
    const platform = createMemoryPlatform();
    const [personal] = (await platform.listWorkspaces()) as [Workspace];
    const team = await platform.createWorkspace('Team', 'team');

    const personalProj = await platform.createProject('Personal Project');
    await platform.moveProjectToWorkspace(personalProj.id, personal.id);
    const teamProj = await platform.createProject('Team Project');
    await platform.moveProjectToWorkspace(teamProj.id, team.id);

    await platform.upsertFile(
      makeFileEntry({ id: 'f1', name: 'Personal File', projectId: personalProj.id }),
      sampleJson('Personal File'),
    );
    await platform.upsertFile(
      makeFileEntry({ id: 'f2', name: 'Team File', projectId: teamProj.id }),
      sampleJson('Team File'),
    );

    const { result } = renderHook(() => useHomeView(platform));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.projects.map((p) => p.id)).toEqual([personalProj.id]);
    expect(result.current.files.map((f) => f.id)).toEqual(['f1']);
  });

  it('switches workspace via setWorkspace and filters content', async () => {
    const platform = createMemoryPlatform();
    const [personal] = (await platform.listWorkspaces()) as [Workspace];
    const team = await platform.createWorkspace('Team', 'team');

    const personalProj = await platform.createProject('Personal Project');
    await platform.moveProjectToWorkspace(personalProj.id, personal.id);
    const teamProj = await platform.createProject('Team Project');
    await platform.moveProjectToWorkspace(teamProj.id, team.id);

    await platform.upsertFile(
      makeFileEntry({ id: 'f1', name: 'Personal File', projectId: personalProj.id }),
      sampleJson('Personal File'),
    );
    await platform.upsertFile(
      makeFileEntry({ id: 'f2', name: 'Team File', projectId: teamProj.id }),
      sampleJson('Team File'),
    );

    const { result } = renderHook(() => useHomeView(platform));
    await waitFor(() => expect(result.current.activeWorkspaceId).toBe(personal.id));

    act(() => result.current.setWorkspace(team.id));
    await waitFor(() => expect(result.current.activeWorkspaceId).toBe(team.id));

    expect(result.current.projects.map((p) => p.id)).toEqual([teamProj.id]);
    expect(result.current.files.map((f) => f.id)).toEqual(['f2']);
  });

  it('keeps unfiled and draft files in the personal workspace only', async () => {
    const platform = createMemoryPlatform();
    const [personal] = (await platform.listWorkspaces()) as [Workspace];
    const team = await platform.createWorkspace('Team', 'team');

    await platform.upsertFile(
      makeFileEntry({ id: 'unfiled', name: 'Unfiled', projectId: null }),
      sampleJson('Unfiled'),
    );
    await platform.upsertFile(
      makeFileEntry({ id: 'draft', name: 'Draft', projectId: '__drafts__' }),
      sampleJson('Draft'),
    );

    const { result } = renderHook(() => useHomeView(platform));
    await waitFor(() => expect(result.current.activeWorkspaceId).toBe(personal.id));

    expect(result.current.files.map((f) => f.id)).toEqual(['unfiled', 'draft']);

    act(() => result.current.setWorkspace(team.id));
    await waitFor(() => expect(result.current.activeWorkspaceId).toBe(team.id));

    expect(result.current.files.map((f) => f.id)).toEqual([]);
  });
});

describe('useHomeView — fuzzy search', () => {
  it('tolerates typos in the toolbar search query', async () => {
    const platform = createMemoryPlatform();
    await platform.upsertFile(
      makeFileEntry({ id: 'f1', name: 'Brand Guidelines' }),
      sampleJson('Brand Guidelines'),
    );
    await platform.upsertFile(
      makeFileEntry({ id: 'f2', name: 'Marketing Plan' }),
      sampleJson('Marketing Plan'),
    );

    const { result } = renderHook(() => useHomeView(platform));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSection('all'));
    act(() => result.current.setFilter({ query: 'brnd' }));
    await waitFor(() => expect(result.current.visibleFiles.length).toBe(1));
    expect(result.current.visibleFiles[0]?.id).toBe('f1');
  });
});

describe('useHomeView — recents and favorites', () => {
  it('lists recent files by lastOpenedAt and favorites by favoritedAt', async () => {
    const platform = createMemoryPlatform();
    await platform.upsertFile(
      makeFileEntry({ id: 'never', name: 'Never Opened', openedAt: 0 }),
      sampleJson('Never Opened'),
    );
    await platform.upsertFile(
      makeFileEntry({ id: 'old', name: 'Old Open', openedAt: 100 }),
      sampleJson('Old Open'),
    );
    await platform.upsertFile(
      makeFileEntry({
        id: 'new',
        name: 'New Open',
        openedAt: 200,
        favoritedAt: 50,
      }),
      sampleJson('New Open'),
    );
    await platform.upsertFile(
      makeFileEntry({
        id: 'fav',
        name: 'Only Fav',
        openedAt: 0,
        favoritedAt: 300,
      }),
      sampleJson('Only Fav'),
    );

    // Populate the new recent-file system too (with increasing timestamps)
    await platform.touchRecentFile('never', 'Never Opened');
    await new Promise((r) => setTimeout(r, 10));
    await platform.touchRecentFile('old', 'Old Open');
    await new Promise((r) => setTimeout(r, 10));
    await platform.touchRecentFile('new', 'New Open');

    const { result } = renderHook(() => useHomeView(platform));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recentFiles.map((f) => f.id)).toEqual(['new', 'old', 'never']);
    expect(result.current.favoriteFiles.map((f) => f.id)).toEqual(['fav', 'new']);
  });
});

describe('useFileActions — workspace-aware project creation', () => {
  it('associates a new project with the active workspace', async () => {
    const platform = createMemoryPlatform();
    const refresh = vi.fn();
    const team = await platform.createWorkspace('Team', 'team');

    const { result } = renderHook(() => useFileActions(platform, refresh));
    const project = await result.current.createProject('Team Initiative', team.id);

    expect(project.workspaceId).toBe(team.id);
    const stored = await platform.listProjects();
    expect(stored.find((p) => p.id === project.id)?.workspaceId).toBe(team.id);
  });
});
