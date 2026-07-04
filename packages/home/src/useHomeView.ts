import type {
  FileEntry,
  FilterState,
  HomeViewState,
  Platform,
  Project,
  SidebarSection,
  SortKey,
  ViewMode,
  Workspace,
} from '@strata/platform';
import { compareBy, DRAFTS_ID, defaultViewState, fuzzyScore, mergeViewState } from '@strata/platform';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface HomeView {
  state: HomeViewState;
  files: FileEntry[];
  trashedFiles: FileEntry[];
  projects: Project[];
  workspaces: Workspace[];
  pinnedFiles: FileEntry[];
  recentFiles: FileEntry[];
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
  setActiveProject: (id: string | null) => void;
  toggleSidebar: () => void;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<HomeViewState>(defaultViewState);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [trashedFiles, setTrashedFiles] = useState<FileEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const viewStateRef = useRef<HomeViewState>(state);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vs, fileList, trashList, projList, wsList] = await Promise.all([
        platform.getViewState().catch(() => defaultViewState()),
        platform.listFiles().catch(() => [] as FileEntry[]),
        platform.listTrashedFiles().catch(() => [] as FileEntry[]),
        platform.listProjects().catch(() => [] as Project[]),
        platform.listWorkspaces().catch(() => [] as Workspace[]),
      ]);
      const merged = mergeViewState(vs);
      viewStateRef.current = merged;
      setState(merged);
      setFiles(fileList);
      setTrashedFiles(trashList);
      setProjects(projList);
      setWorkspaces(wsList);
    } finally {
      setLoading(false);
    }
  }, [platform]);

  const persist = useCallback(
    (s: HomeViewState) => {
      viewStateRef.current = s;
      setState(s);
      platform.setViewState(s);
    },
    [platform],
  );

  useEffect(() => {
    load();
  }, [load]);

  const pinnedFiles = files.filter((f) => f.pinned && !f.trashedAt);
  const recentFiles = [...files]
    .filter((f) => f.openedAt > 0 && !f.trashedAt)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, 30);

  const draftFiles = files.filter((f) => f.projectId === DRAFTS_ID && !f.trashedAt);
  const favoriteFiles = [...files]
    .filter((f) => f.favoritedAt !== null && f.favoritedAt !== undefined && f.favoritedAt > 0)
    .sort((a, b) => (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0));

  const continueWorkingFiles = [...files]
    .filter((f) => !f.trashedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const visibleFiles = computeVisibleFiles(files, state, projects);

  return {
    state,
    files,
    trashedFiles,
    projects,
    workspaces,
    pinnedFiles,
    recentFiles,
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
    setActiveProject: (id) => {
      persist({
        ...viewStateRef.current,
        activeProjectId: id,
        section: 'project' as SidebarSection,
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

function computeVisibleFiles(
  all: FileEntry[],
  state: HomeViewState,
  _projects: Project[],
): FileEntry[] {
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
    const q = filter.query.toLowerCase();
    result = result.filter((f) => f.name.toLowerCase().includes(q));
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
