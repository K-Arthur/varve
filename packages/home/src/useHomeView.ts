import type {
  FileEntry,
  FilterState,
  HomeViewState,
  Platform,
  Project,
  SidebarSection,
  SortKey,
  ViewMode,
} from '@strata/platform';
import { compareBy, defaultViewState, mergeViewState } from '@strata/platform';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface HomeView {
  state: HomeViewState;
  files: FileEntry[];
  trashedFiles: FileEntry[];
  projects: Project[];
  pinnedFiles: FileEntry[];
  recentFiles: FileEntry[];
  /** Files filtered by the current sidebar section + filters. */
  visibleFiles: FileEntry[];
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
  const [loading, setLoading] = useState(true);
  const viewStateRef = useRef<HomeViewState>(state);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vs, fileList, trashList, projList] = await Promise.all([
        platform.getViewState().catch(() => defaultViewState()),
        platform.listFiles().catch(() => [] as FileEntry[]),
        platform.listTrashedFiles().catch(() => [] as FileEntry[]),
        platform.listProjects().catch(() => [] as Project[]),
      ]);
      const merged = mergeViewState(vs);
      viewStateRef.current = merged;
      setState(merged);
      setFiles(fileList);
      setTrashedFiles(trashList);
      setProjects(projList);
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

  const visibleFiles = computeVisibleFiles(files, state, projects);

  return {
    state,
    files,
    trashedFiles,
    projects,
    pinnedFiles,
    recentFiles,
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
