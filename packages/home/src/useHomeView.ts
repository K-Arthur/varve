import type {
  EditorWorkspaceMode,
  FileEntry,
  FilterState,
  HomeViewState,
  Platform,
  Project,
  RecentFileRecord,
  RecentWorkspaceFilter,
  SidebarSection,
  SortKey,
  ViewMode,
  Workspace,
} from '@varve/platform';
import {
  compareBy,
  DEFAULT_RECENT_WORKSPACE_FILTER,
  DRAFTS_ID,
  defaultViewState,
  filterRecentByWorkspace,
  fuzzyScore,
  mergeViewState,
  recentFileSections,
} from '@varve/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface HomeView {
  state: HomeViewState;
  files: FileEntry[];
  trashedFiles: FileEntry[];
  projects: Project[];
  workspaces: Workspace[];
  /** Currently selected workspace id; null when no workspace exists. */
  activeWorkspaceId: string | null;
  pinnedFiles: FileEntry[];
  recentFiles: RecentFileRecord[];
  recentRecords: RecentFileRecord[];
  recentFilteredRecords: RecentFileRecord[];
  recentWorkspaceFilter: RecentWorkspaceFilter;
  recentSectionCounts: ReturnType<typeof recentFileSections>;
  /** The 5 most recently updated files — shown as priority "Continue working" items. */
  continueWorkingFiles: FileEntry[];
  /** Files filtered by the current sidebar section + filters. */
  visibleFiles: FileEntry[];
  /** Files whose projectId === DRAFTS_ID. */
  draftFiles: FileEntry[];
  /** Files where favoritedAt > 0, sorted by favoritedAt descending. */
  favoriteFiles: FileEntry[];
  loading: boolean;
}

export function useHomeView(platform: Platform): HomeView & {
  setSection: (s: SidebarSection) => void;
  setView: (v: ViewMode) => void;
  setSortKey: (k: SortKey) => void;
  toggleSortDir: () => void;
  setFilter: (f: Partial<FilterState>) => void;
  setRecentWorkspaceFilter: (f: RecentWorkspaceFilter) => void;
  setActiveProject: (id: string | null) => void;
  setWorkspace: (id: string) => void;
  toggleSidebar: () => void;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<HomeViewState>(defaultViewState);
  const [allFiles, setAllFiles] = useState<FileEntry[]>([]);
  const [allTrashedFiles, setAllTrashedFiles] = useState<FileEntry[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [recentRecords, setRecentRecords] = useState<RecentFileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const viewStateRef = useRef<HomeViewState>(state);
  const viewStateRevisionRef = useRef(0);

  const load = useCallback(async () => {
    const loadRevision = viewStateRevisionRef.current;
    setLoading(true);
    try {
      const [vs, fileList, trashList, projList, wsList] = await Promise.all([
        platform.getViewState().catch(() => defaultViewState()),
        platform.listFiles().catch(() => [] as FileEntry[]),
        platform.listTrashedFiles().catch(() => [] as FileEntry[]),
        platform.listProjects().catch(() => [] as Project[]),
        platform.listWorkspaces().catch(() => [] as Workspace[]),
      ]);
      const recentList: RecentFileRecord[] = await (platform.listRecentFiles?.().catch(() => []) ??
        Promise.resolve([]));
      const merged = mergeViewState(vs);
      const workspaceIds = new Set(wsList.map((w) => w.id));
      const personal = wsList.find((w) => w.kind === 'personal') ?? wsList[0] ?? null;
      const activeWorkspaceId =
        merged.activeWorkspaceId && workspaceIds.has(merged.activeWorkspaceId)
          ? merged.activeWorkspaceId
          : (personal?.id ?? null);
      const next: HomeViewState = { ...merged, activeWorkspaceId };
      // A user can click a sidebar item while the initial platform reads are
      // still pending. Preserve that newer local interaction instead of
      // replacing it with the stale persisted view state when the reads land.
      if (viewStateRevisionRef.current === loadRevision) {
        viewStateRef.current = next;
        setState(next);
        platform.setViewState(next);
      }
      setAllFiles(fileList);
      setAllTrashedFiles(trashList);
      setAllProjects(projList);
      setWorkspaces(wsList);
      setRecentRecords(recentList);
    } finally {
      setLoading(false);
    }
  }, [platform]);

  const persist = useCallback(
    (s: HomeViewState) => {
      viewStateRevisionRef.current += 1;
      viewStateRef.current = s;
      setState(s);
      platform.setViewState(s);
    },
    [platform],
  );

  useEffect(() => {
    load();
  }, [load]);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === state.activeWorkspaceId) ?? workspaces[0] ?? null,
    [workspaces, state.activeWorkspaceId],
  );

  const projects = useMemo(
    () => allProjects.filter((p) => isProjectInWorkspace(p, activeWorkspace)),
    [allProjects, activeWorkspace],
  );

  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);

  const files = useMemo(
    () => allFiles.filter((f) => isFileInWorkspace(f, activeWorkspace, projectIds)),
    [allFiles, activeWorkspace, projectIds],
  );

  const trashedFiles = useMemo(
    () => allTrashedFiles.filter((f) => isFileInWorkspace(f, activeWorkspace, projectIds)),
    [allTrashedFiles, activeWorkspace, projectIds],
  );

  const pinnedFiles = files.filter((f) => f.pinned && !f.trashedAt);
  const recentFiles = recentRecords
    .filter((r) => !r.hidden && !r.missing)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, 30);

  const draftFiles = files.filter((f) => f.projectId === DRAFTS_ID && !f.trashedAt);
  const favoriteFiles = [...files]
    .filter((f) => f.favoritedAt !== null && f.favoritedAt !== undefined && f.favoritedAt > 0)
    .sort((a, b) => (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0));

  const continueWorkingFiles = [...files]
    .filter((f) => !f.trashedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const visibleFiles = computeVisibleFiles(files, state);

  const recentSectionCounts = useMemo(() => recentFileSections(recentRecords), [recentRecords]);
  const recentWorkspaceFilter: RecentWorkspaceFilter =
    state.filter.recentWorkspaceFilter ?? DEFAULT_RECENT_WORKSPACE_FILTER;
  const editorMode: EditorWorkspaceMode | undefined =
    state.filter.recentWorkspaceFilter?.editorMode;
  const recentFilteredRecords = useMemo(() => {
    const relevant = filterRecentByWorkspace(recentRecords, recentWorkspaceFilter, editorMode);
    // Encrypted projects excluded from relevance inference
    if (recentWorkspaceFilter.mode !== 'all') {
      return relevant.filter((r) => !r.encrypted || r.userWorkspaceTag != null);
    }
    return relevant;
  }, [recentRecords, recentWorkspaceFilter, editorMode]);

  return {
    state,
    files,
    trashedFiles,
    projects,
    workspaces,
    activeWorkspaceId: activeWorkspace?.id ?? null,
    pinnedFiles,
    recentFiles,
    recentRecords,
    recentFilteredRecords,
    recentWorkspaceFilter,
    recentSectionCounts,
    continueWorkingFiles,
    draftFiles,
    favoriteFiles,
    visibleFiles,
    loading,
    setSection: (section) => {
      const next = {
        ...viewStateRef.current,
        section,
        activeProjectId: section === 'project' ? viewStateRef.current.activeProjectId : null,
      };
      persist(next);
    },
    setView: (view) => {
      persist({ ...viewStateRef.current, view });
    },
    setSortKey: (key) => {
      const current = viewStateRef.current.sort;
      const sort =
        current.key === key
          ? { key, direction: (current.direction === 'asc' ? 'desc' : 'asc') as 'asc' | 'desc' }
          : { key, direction: 'desc' as 'asc' | 'desc' };
      persist({ ...viewStateRef.current, sort });
    },
    toggleSortDir: () => {
      const sort = {
        key: viewStateRef.current.sort.key,
        direction: (viewStateRef.current.sort.direction === 'asc' ? 'desc' : 'asc') as
          | 'asc'
          | 'desc',
      };
      persist({ ...viewStateRef.current, sort });
    },
    setFilter: (f) => {
      const filter = { ...viewStateRef.current.filter, ...f } as FilterState;
      persist({ ...viewStateRef.current, filter });
    },
    setRecentWorkspaceFilter: (f: RecentWorkspaceFilter) => {
      const filter = { ...viewStateRef.current.filter, recentWorkspaceFilter: f } as FilterState;
      persist({ ...viewStateRef.current, filter });
    },
    setActiveProject: (id) => {
      persist({
        ...viewStateRef.current,
        activeProjectId: id,
        section: 'project' as SidebarSection,
      });
    },
    setWorkspace: (id) => {
      const target = workspaces.find((w) => w.id === id);
      if (!target) return;
      const projectsInTarget = allProjects.filter((p) => isProjectInWorkspace(p, target));
      const projectIdsInTarget = new Set(projectsInTarget.map((p) => p.id));
      const currentProjectId = viewStateRef.current.activeProjectId;
      const nextProjectId =
        currentProjectId && projectIdsInTarget.has(currentProjectId) ? currentProjectId : null;
      persist({
        ...viewStateRef.current,
        activeWorkspaceId: id,
        activeProjectId: nextProjectId,
      });
    },
    toggleSidebar: () => {
      persist({
        ...viewStateRef.current,
        sidebarCollapsed: !viewStateRef.current.sidebarCollapsed,
      });
    },
    refresh: load,
  };
}

function isProjectInWorkspace(project: Project, workspace: Workspace | null): boolean {
  if (!workspace) return true;
  if (project.workspaceId === workspace.id) return true;
  return workspace.kind === 'personal' && !project.workspaceId;
}

function isFileInWorkspace(
  file: FileEntry,
  workspace: Workspace | null,
  projectIds: Set<string>,
): boolean {
  if (!workspace) return true;
  if (file.projectId === DRAFTS_ID) return workspace.kind === 'personal';
  if (file.projectId === null) return workspace.kind === 'personal';
  return projectIds.has(file.projectId);
}

function computeVisibleFiles(all: FileEntry[], state: HomeViewState): FileEntry[] {
  let result = all.filter((f) => !f.trashedAt);

  switch (state.section) {
    case 'recent':
      result = result.filter((f) => f.openedAt > 0);
      result.sort((a, b) => b.openedAt - a.openedAt);
      result = result.slice(0, 30);
      break;
    case 'all':
      break;
    case 'project':
      result = result.filter((f) => f.projectId === state.activeProjectId);
      break;
    case 'drafts':
      result = result.filter((f) => f.projectId === DRAFTS_ID);
      break;
    case 'favorites':
      result = result.filter(
        (f) => f.favoritedAt !== null && f.favoritedAt !== undefined && f.favoritedAt > 0,
      );
      result.sort((a, b) => (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0));
      break;
    case 'collections':
      return [];
    case 'activity':
      return [];
    case 'templates':
      return [];
    case 'trash':
      return [];
  }

  const { filter } = state;
  if (filter.query) {
    result = result.filter((f) => fuzzyScore(filter.query, f.name) >= 0.3);
  }
  if (filter.kinds.length > 0) {
    result = result.filter((f) => filter.kinds.includes(f.kind));
  }
  if (filter.pinnedOnly) {
    result = result.filter((f) => f.pinned);
  }
  if (filter.dateFrom) {
    const dateFrom = filter.dateFrom;
    result = result.filter((f) => f.updatedAt >= dateFrom);
  }
  if (filter.dateTo) {
    const dateTo = filter.dateTo;
    result = result.filter((f) => f.updatedAt <= dateTo);
  }

  const pinned = result.filter((f) => f.pinned);
  const unpinned = result.filter((f) => !f.pinned);

  pinned.sort(compareBy(state.sort.key, state.sort.direction));
  unpinned.sort(compareBy(state.sort.key, state.sort.direction));

  return [...pinned, ...unpinned];
}
