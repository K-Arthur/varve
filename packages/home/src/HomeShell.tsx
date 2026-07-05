import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  contentHash,
  detectFileKind,
  type FileEntry,
  type Platform,
  type TemplateLibrary,
} from '@strata/platform';
import { generateKeyBetween } from '@strata/shared';
import { Dialog, Icon } from '@strata/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityFeed } from './ActivityFeed';
import { AssetBrowser } from './AssetBrowser';
import { BatchActions } from './BatchActions';
import { BulkImportDialog } from './BulkImportDialog';
import { EmptyStates } from './EmptyStates';
import { FileContextMenu, type FileMenuAction } from './FileContextMenu';
import { FileGrid } from './FileGrid';
import { FileList } from './FileList';
import type { FormatMigrationResult } from './FormatMigration';
import { HomeSearchPalette } from './HomeSearchPalette';
import { HomeShortcutHelp } from './HomeShortcutHelp';
import { HomeToolbar } from './HomeToolbar';
import { NewFileDialog } from './NewFileDialog';
import { PerfProfile } from './PerfProfile';
import { ProjectsView } from './ProjectsView';
import { type SidebarEntry, SidebarNav } from './SidebarNav';
import { TemplatesGallery } from './TemplatesGallery';
import { TrashSection } from './TrashSection';
import { useFileActions } from './useFileActions';
import { type HomeShortcutHandlers, useHomeShortcuts } from './useHomeShortcuts';
import { useHomeView } from './useHomeView';
import { useThumbnailLoader } from './useThumbnailLoader';
import { VersionHistory } from './VersionHistory';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export interface HomeShellProps {
  platform: Platform;
  onOpenFile: (entry: FileEntry) => void;
  /** When an editor session is alive behind the home screen, lets the user
   *  jump back to it without reopening a file. */
  onResumeEditing?: () => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

async function generateThumbnail(platform: Platform, _entry: FileEntry, docJson: string) {
  try {
    const { renderThumbnail } = await import('@strata/engine');
    const doc = JSON.parse(docJson);
    const dataUrl = await renderThumbnail(doc);
    if (dataUrl) {
      await platform.putThumbnail({
        hash: contentHash(docJson),
        dataUrl,
        width: 256,
        height: 192,
        createdAt: Date.now(),
      });
    }
  } catch {
    // Thumbnail generation is best-effort; non-fatal if it fails.
  }
}

export function HomeShell({ platform, onOpenFile, onResumeEditing }: HomeShellProps) {
  const view = useHomeView(platform);
  const actions = useFileActions(platform, view.refresh);
  const thumbnails = useThumbnailLoader(platform);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [searchPaletteOpen, setSearchPaletteOpen] = useState(false);
  const [contextPos, setContextPos] = useState<{ x: number; y: number } | null>(null);
  const [contextFile, setContextFile] = useState<FileEntry | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [missingFiles, setMissingFiles] = useState<Set<string>>(new Set());
  const [versionHistoryFileId, setVersionHistoryFileId] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [_bulkImportOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateLibrary[]>([]);
  const [_migrationResults] = useState<FormatMigrationResult[] | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    platform
      .listenForChanges(() => view.refresh())
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [platform, view]);

  // Detect missing or stale files
  useEffect(() => {
    const checkMissingFiles = async () => {
      const missing = new Set<string>();
      for (const file of view.files) {
        if (file.filePath) {
          // Desktop: check actual file existence on disk
          const exists = await platform.fileExists(file.filePath);
          if (!exists) {
            missing.add(file.id);
          }
        } else if (platform.kind === 'web') {
          // Web: mark files as stale if not updated in 90 days
          const STALE_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;
          const age = Date.now() - file.updatedAt;
          if (age > STALE_THRESHOLD_MS) {
            missing.add(file.id);
          }
        }
      }
      setMissingFiles(missing);
    };

    checkMissingFiles();
  }, [platform, view.files]);

  useEffect(() => {
    platform
      .listTemplates()
      .then((list) => setTemplates(list))
      .catch(() => setTemplates([]));
  }, [platform]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      for (const file of files) {
        const name = file.name.replace(/\.[^.]+$/, '');
        const kind = detectFileKind(file.name);
        if (kind === 'unknown') continue;

        const text = await file.text();
        const id = crypto.randomUUID();
        const now = Date.now();
        const entry: FileEntry = {
          id,
          name,
          kind,
          projectId: null,
          createdAt: now,
          updatedAt: now,
          openedAt: now,
          size: text.length,
          pinned: false,
          trashedAt: null,
          ordering: '',
          contentHash: '',
        };
        await platform.upsertFile(entry, text);
        if (files.length === 1) onOpenFile(entry);
      }
      view.refresh();
    },
    [platform, onOpenFile, view],
  );

  const dialogOpen = newFileOpen || contextPos !== null;

  const shortcutHandlers: HomeShortcutHandlers = {
    newFile: useCallback(() => setNewFileOpen(true), []),
    openFromDisk: useCallback(async () => {
      const result = await platform.openDocumentFromDisk();
      if (result) onOpenFile(result.entry);
    }, [platform, onOpenFile]),
    templates: useCallback(() => view.setSection('templates'), [view]),
    closeDialog: useCallback(() => {
      setNewFileOpen(false);
      setContextPos(null);
      setContextFile(null);
    }, []),
    selectAll: useCallback(() => {
      setSelectedIds(view.visibleFiles.map((f) => f.id));
    }, [view.visibleFiles]),
    showHelp: useCallback(() => setShortcutHelpOpen(true), []),
    importFiles: useCallback(() => setImportOpen(true), []),
    searchCommand: useCallback(() => setSearchPaletteOpen(true), []),
  };
  useHomeShortcuts(shortcutHandlers, dialogOpen);

  const sidebarEntries: SidebarEntry[] = [
    { id: 'recent', label: 'Recent', icon: 'Clock', count: view.recentFiles.length },
    {
      id: 'all',
      label: 'All Files',
      icon: 'FileText',
      count: view.files.length - view.trashedFiles.length,
    },
    { id: 'drafts', label: 'Drafts', icon: 'Pen' as const, count: view.draftFiles.length },
    ...(view.favoriteFiles.length > 0
      ? [
          {
            id: 'favorites',
            label: 'Favorites',
            icon: 'Star' as const,
            count: view.favoriteFiles.length,
          },
        ]
      : []),
    ...view.projects.map((p) => ({
      id: p.id,
      label: p.name,
      icon: 'Folder' as const,
      count: view.files.filter((f) => f.projectId === p.id).length,
      pinned: p.pinned,
    })),
    { id: 'templates', label: 'Templates', icon: 'LayoutGrid', count: 0 },
    { id: 'assets', label: 'Assets', icon: 'Image', count: 0 },
    { id: 'activity', label: 'Activity', icon: 'History', count: 0 },
    { id: 'trash', label: 'Trash', icon: 'Archive', count: view.trashedFiles.length },
  ];

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const sensors = useSensors(pointerSensor);

  const filesByOrdering = useMemo(
    () =>
      [...view.files]
        .filter((f) => !f.trashedAt)
        .sort((a, b) =>
          (a.ordering || '') < (b.ordering || '')
            ? -1
            : (a.ordering || '') > (b.ordering || '')
              ? 1
              : 0,
        ),
    [view.files],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);

      if (over.data.current?.type === 'project') {
        actions.moveToProject(activeId, overId);
        return;
      }

      const sorted = filesByOrdering;
      const remaining = sorted.filter((f) => f.id !== activeId);
      const overIdx = remaining.findIndex((f) => f.id === overId);
      if (overIdx === -1) return;

      const prevKey = overIdx > 0 ? (remaining[overIdx - 1]?.ordering ?? null) : null;
      const nextKey = remaining[overIdx]?.ordering ?? null;
      const newKey = generateKeyBetween(prevKey, nextKey);

      platform.reorderFile(activeId, newKey).then(() => view.refresh());
    },
    [filesByOrdering, platform, actions, view],
  );

  const handleFileDragStart = useCallback((e: React.DragEvent, entry: FileEntry) => {
    e.dataTransfer.setData('text/strata-file-id', entry.id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDropOnProject = useCallback(
    (fileId: string, projectId: string) => {
      actions.moveToProject(fileId, projectId);
    },
    [actions],
  );

  const handleFileContext = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextFile(entry);
    setContextPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleStartRename = useCallback((id: string | null) => {
    setRenamingId(id);
  }, []);

  const handleContextAction = useCallback(
    (action: FileMenuAction) => {
      if (!contextFile) return;
      switch (action) {
        case 'open':
          onOpenFile(contextFile);
          break;
        case 'rename': {
          handleStartRename(contextFile.id);
          break;
        }
        case 'duplicate': {
          platform.readFile(contextFile.id).then((json) => {
            if (json) actions.duplicate(contextFile, json);
          });
          break;
        }
        case 'trash':
          actions.trash(contextFile.id);
          break;
        case 'restore':
          actions.restore(contextFile.id);
          break;
        case 'purge': {
          if (confirm('Permanently delete this file? This cannot be undone.')) {
            actions.purge(contextFile.id);
          }
          break;
        }
        case 'versions':
          setVersionHistoryFileId(contextFile.id);
          break;
        case 'pin':
          actions.togglePin(contextFile);
          break;
        case 'locate': {
          if (contextFile.filePath) {
            platform.revealInFileManager(contextFile.filePath);
          }
          break;
        }
        case 'remove': {
          actions.purge(contextFile.id);
          break;
        }
      }
      setContextPos(null);
      setContextFile(null);
    },
    [contextFile, actions, onOpenFile, platform, handleStartRename],
  );

  const handleMoveToProject = useCallback(
    (projectId: string | null) => {
      if (!contextFile) return;
      actions.moveToProject(contextFile.id, projectId);
      setContextPos(null);
      setContextFile(null);
    },
    [contextFile, actions],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedIds([id]);
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      } else {
        return [...prev, id];
      }
    });
  }, []);

  const handleSelectRange = useCallback(
    (fromIdx: number, toIdx: number) => {
      const start = Math.min(fromIdx, toIdx);
      const end = Math.max(fromIdx, toIdx);
      const range = view.visibleFiles.slice(start, end + 1);
      setSelectedIds(range.map((f) => f.id));
    },
    [view.visibleFiles],
  );

  const handleSelectAll = useCallback(() => {
    setSelectedIds(view.visibleFiles.map((f) => f.id));
  }, [view.visibleFiles]);

  const handleRename = useCallback(
    (id: string, newName: string) => {
      actions.rename(id, newName);
      setRenamingId(null);
    },
    [actions],
  );

  // Create a document from a preset (blank or print) and open it. Shared by the
  // New File dialog and the home quick-start row.
  const createFromPreset = useCallback(
    (name: string) => {
      const id = crypto.randomUUID();
      const now = Date.now();
      const doc = {
        id,
        name,
        rootChildren: [] as string[],
        nodes: {},
        components: {},
        nextId: 1,
      };
      const docJson = JSON.stringify(doc);
      const entry: FileEntry = {
        id,
        name,
        kind: 'strata',
        projectId: null,
        createdAt: now,
        updatedAt: now,
        openedAt: now,
        size: docJson.length,
        pinned: false,
        trashedAt: null,
        ordering: '',
        contentHash: '',
      };
      platform.upsertFile(entry, docJson);
      generateThumbnail(platform, entry, docJson);
      onOpenFile(entry);
    },
    [platform, onOpenFile],
  );

  const handleImport = useCallback(async () => {
    const result = await platform.openDocumentFromDisk();
    if (result) onOpenFile(result.entry);
  }, [platform, onOpenFile]);

  const renderContent = () => {
    if (view.loading) {
      return (
        <div className="strata-empty">
          <div className="strata-empty__headline">Loading...</div>
        </div>
      );
    }

    const { state, visibleFiles, projects, trashedFiles } = view;

    switch (state.section) {
      case 'templates':
        return (
          <TemplatesGallery
            onSelect={(template) => {
              const id = crypto.randomUUID();
              const now = Date.now();
              const docJson = template.documentJson;
              const entry: FileEntry = {
                id,
                name: template.name,
                kind: 'strata',
                projectId: null,
                createdAt: now,
                updatedAt: now,
                openedAt: now,
                size: docJson.length,
                pinned: false,
                trashedAt: null,
                ordering: '',
                contentHash: '',
              };
              platform.upsertFile(entry, docJson);
              generateThumbnail(platform, entry, docJson);
              onOpenFile(entry);
            }}
          />
        );
      case 'trash':
        return trashedFiles.length === 0 ? (
          <EmptyStates section="trash" onAction={() => view.setSection('recent')} />
        ) : (
          <TrashSection
            files={trashedFiles}
            onRestore={actions.restore}
            onPurge={actions.purge}
            onRefresh={view.refresh}
          />
        );
      case 'project':
        return state.activeProjectId ? (
          <ProjectsView
            project={projects.find((p) => p.id === state.activeProjectId) ?? null}
            files={visibleFiles}
            thumbnails={thumbnails.thumbnails}
            platform={platform}
            onOpen={onOpenFile}
            onContext={handleFileContext}
            onRename={actions.renameProject}
            onDelete={actions.deleteProject}
            onFileRename={handleRename}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onToggleSelect={handleToggleSelect}
            onSelectRange={handleSelectRange}
            onSelectAll={handleSelectAll}
            renamingId={renamingId}
            onStartRename={handleStartRename}
            missingFiles={missingFiles}
          />
        ) : (
          <EmptyStates section="project" onAction={() => view.setSection('recent')} />
        );
      case 'collections':
        return <EmptyStates section="collections" onAction={() => view.setSection('all')} />;
      case 'activity':
        return (
          <ActivityFeed
            platform={platform}
            workspaceId={view.activeWorkspaceId ?? 'personal'}
            onOpenFile={(fileId) => {
              const entry = view.files.find((f) => f.id === fileId);
              if (entry) onOpenFile(entry);
            }}
          />
        );
      case 'assets':
        return (
          <AssetBrowser platform={platform} workspaceId={view.activeWorkspaceId ?? 'personal'} />
        );
      default: {
        const heroSubtitle = state.filter.query
          ? `${visibleFiles.length} result${visibleFiles.length !== 1 ? 's' : ''} for "${state.filter.query}"`
          : state.section === 'recent'
            ? 'Recent designs'
            : state.section === 'drafts'
              ? 'Draft designs'
              : state.section === 'favorites'
                ? 'Favorite designs'
                : 'All designs';
        return (
          <>
            <header className="strata-home__hero">
              <p className="strata-home__hero-greeting">
                {greeting()}
                {state.section === 'all' ? '' : ', welcome back'}
              </p>
              <p className="strata-home__hero-subtitle">{heroSubtitle}</p>
            </header>
            {!state.filter.query && (state.section === 'all' || state.section === 'recent') && (
              <div className="quick-start">
                <button
                  type="button"
                  className="quick-start__card quick-start__card--primary"
                  onClick={() => createFromPreset('Untitled')}
                >
                  <span className="quick-start__icon" aria-hidden>
                    <Icon name="Plus" label={undefined} size="1.4rem" />
                  </span>
                  <span className="quick-start__text">
                    <span className="quick-start__title">Blank canvas</span>
                    <span className="quick-start__sub">Start designing right away</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="quick-start__card"
                  onClick={() => view.setSection('templates')}
                >
                  <span className="quick-start__icon" aria-hidden>
                    <Icon name="LayoutGrid" label={undefined} size="1.4rem" />
                  </span>
                  <span className="quick-start__text">
                    <span className="quick-start__title">Templates</span>
                    <span className="quick-start__sub">Start from a preset</span>
                  </span>
                </button>
                <button type="button" className="quick-start__card" onClick={handleImport}>
                  <span className="quick-start__icon" aria-hidden>
                    <Icon name="Upload" label={undefined} size="1.4rem" />
                  </span>
                  <span className="quick-start__text">
                    <span className="quick-start__title">Import</span>
                    <span className="quick-start__sub">Open a file from disk</span>
                  </span>
                </button>
              </div>
            )}
            {visibleFiles.length === 0 && !state.filter.query ? (
              <EmptyStates section={state.section} onAction={() => setNewFileOpen(true)} />
            ) : visibleFiles.length === 0 ? (
              <EmptyStates
                section="search"
                query={state.filter.query}
                onAction={() => view.setFilter({ query: '' })}
              />
            ) : state.view === 'grid' ? (
              <FileGrid
                files={visibleFiles}
                thumbnails={thumbnails.thumbnails}
                onLoadThumbnail={thumbnails.load}
                onOpen={onOpenFile}
                onContext={handleFileContext}
                onFileDragStart={handleFileDragStart}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onToggleSelect={handleToggleSelect}
                onSelectRange={handleSelectRange}
                onSelectAll={handleSelectAll}
                onRename={handleRename}
                renamingId={renamingId}
                onStartRename={handleStartRename}
                missingFiles={missingFiles}
              />
            ) : (
              <FileList
                files={visibleFiles}
                thumbnails={thumbnails.thumbnails}
                onLoadThumbnail={thumbnails.load}
                onOpen={onOpenFile}
                onContext={handleFileContext}
                sortKey={state.sort.key}
                sortDirection={state.sort.direction}
                onSort={view.setSortKey}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onToggleSelect={handleToggleSelect}
                onSelectRange={handleSelectRange}
                onSelectAll={handleSelectAll}
                onRename={handleRename}
                renamingId={renamingId}
                onStartRename={handleStartRename}
                missingFiles={missingFiles}
              />
            )}
          </>
        );
      }
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={undefined} onDragEnd={handleDragEnd}>
      <section
        className={`strata-home ${view.state.sidebarCollapsed ? 'strata-home--collapsed' : ''} ${isDragOver ? 'strata-home--drag-over' : ''}`}
        aria-label="File drop zone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {sidebarOpen && (
          <button
            type="button"
            className="drawer-overlay drawer-overlay--visible"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div className={`strata-home__sidebar ${sidebarOpen ? 'strata-home__sidebar--open' : ''}`}>
          <div className="sidebar-brand">
            <img src="/icons/strata-wordmark.svg" alt="Strata" className="sidebar-brand__logo" />
          </div>
          {onResumeEditing && (
            <button
              type="button"
              className="sidebar-resume"
              onClick={onResumeEditing}
              title="Return to your open tabs"
            >
              <Icon name="ArrowLeft" label={undefined} size="1em" />
              <span>Continue editing</span>
            </button>
          )}
          {view.workspaces.length > 0 && (
            <WorkspaceSwitcher
              workspaces={view.workspaces}
              activeId={view.activeWorkspaceId ?? 'personal'}
              onSwitch={view.setWorkspace}
            />
          )}
          <SidebarNav
            entries={sidebarEntries}
            activeId={
              view.state.section === 'project'
                ? (view.state.activeProjectId ?? 'all')
                : view.state.section
            }
            onSelect={(id) => {
              if (
                [
                  'recent',
                  'all',
                  'drafts',
                  'favorites',
                  'collections',
                  'activity',
                  'assets',
                  'templates',
                  'trash',
                ].includes(id)
              ) {
                view.setSection(
                  id as
                    | 'recent'
                    | 'all'
                    | 'drafts'
                    | 'favorites'
                    | 'collections'
                    | 'activity'
                    | 'assets'
                    | 'templates'
                    | 'trash',
                );
              } else {
                view.setActiveProject(id);
              }
              setSidebarOpen(false);
            }}
            onPin={(id) => {
              const proj = view.projects.find((p) => p.id === id);
              if (proj) platform.setProjectPinned(proj.id, !proj.pinned);
            }}
            onDropOnProject={handleDropOnProject}
            onCreateProject={async () => {
              setNewProjectOpen(true);
            }}
          />
        </div>
        <div className="strata-home__toolbar">
          <HomeToolbar
            sidebarCollapsed={view.state.sidebarCollapsed}
            onToggleSidebar={view.toggleSidebar}
            viewMode={view.state.view}
            onViewModeChange={view.setView}
            query={view.state.filter.query}
            onQueryChange={(q) => view.setFilter({ query: q })}
            resultCount={view.visibleFiles.length}
            sortKey={view.state.sort.key}
            sortDirection={view.state.sort.direction}
            onSortKeyChange={view.setSortKey}
            onSortDirToggle={view.toggleSortDir}
            onNewFile={() => setNewFileOpen(true)}
            onOpenFromDisk={async () => {
              const result = await platform.openDocumentFromDisk();
              if (result) onOpenFile(result.entry);
            }}
            kindFilter={view.state.filter.kinds}
            pinnedOnly={view.state.filter.pinnedOnly}
            dateFrom={view.state.filter.dateFrom}
            dateTo={view.state.filter.dateTo}
            onKindFilterChange={(kinds) => view.setFilter({ kinds })}
            onPinnedOnlyChange={(pinnedOnly) => view.setFilter({ pinnedOnly })}
            onDateFromChange={(dateFrom) => view.setFilter({ dateFrom })}
            onDateToChange={(dateTo) => view.setFilter({ dateTo })}
            onClearFilters={() =>
              view.setFilter({ kinds: [], pinnedOnly: false, dateFrom: null, dateTo: null })
            }
          />
        </div>
        {selectedIds.length > 0 && (
          <div className="strata-home__batch-bar">
            <BatchActions
              selectedCount={selectedIds.length}
              projects={view.projects}
              onMoveToProject={(projectId) => {
                for (const id of selectedIds) {
                  actions.moveToProject(id, projectId);
                }
                setSelectedIds([]);
              }}
              onTrash={() => {
                for (const id of selectedIds) {
                  actions.trash(id);
                }
                setSelectedIds([]);
              }}
              onFavorite={() => {
                for (const id of selectedIds) {
                  const entry = view.files.find((f) => f.id === id);
                  if (entry) actions.togglePin(entry);
                }
                setSelectedIds([]);
              }}
              onExport={() => {
                // Export is a no-op in the home view for now
                setSelectedIds([]);
              }}
              onDeselect={() => setSelectedIds([])}
            />
          </div>
        )}
        <main className="strata-home__content">
          {renderContent()}
          <PerfProfile
            fileCount={view.files.length}
            renderStartTime={Date.now()}
            searchResultCount={view.visibleFiles.length}
          />
        </main>

        <NewFileDialog
          open={newFileOpen}
          onClose={() => setNewFileOpen(false)}
          onCreate={(preset) => {
            createFromPreset(preset.name);
            setNewFileOpen(false);
          }}
        />
        {contextPos && contextFile && (
          <FileContextMenu
            file={contextFile}
            position={contextPos}
            onAction={handleContextAction}
            onMoveToProject={handleMoveToProject}
            onClose={() => {
              setContextPos(null);
              setContextFile(null);
            }}
            projects={view.projects}
            isTrash={view.state.section === 'trash'}
            isMissing={missingFiles.has(contextFile.id)}
          />
        )}
        <HomeSearchPalette
          open={searchPaletteOpen}
          onClose={() => setSearchPaletteOpen(false)}
          onOpenFile={(id) => {
            const entry = view.files.find((f) => f.id === id);
            if (entry) onOpenFile(entry);
            setSearchPaletteOpen(false);
          }}
          files={view.files.filter((f) => !f.trashedAt)}
          projects={view.projects}
          templates={templates}
        />
        <HomeShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
        {versionHistoryFileId && (
          <VersionHistory
            fileId={versionHistoryFileId}
            platform={platform}
            onRestore={(_versionId) => {
              setVersionHistoryFileId(null);
            }}
            onClose={() => setVersionHistoryFileId(null)}
          />
        )}
        <Dialog
          open={newProjectOpen}
          title="New Project"
          onClose={() => {
            setNewProjectOpen(false);
            setNewProjectName('');
          }}
        >
          <div className="strata-home__new-project-dialog">
            <label htmlFor="new-project-name" className="strata-home__new-project-label">
              Project name
            </label>
            <input
              id="new-project-name"
              type="text"
              className="strata-home__new-project-input"
              placeholder="e.g. Brand Redesign"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newProjectName.trim()) {
                  actions.createProject(newProjectName.trim(), view.activeWorkspaceId ?? undefined);
                  setNewProjectName('');
                  setNewProjectOpen(false);
                }
                if (e.key === 'Escape') {
                  setNewProjectName('');
                  setNewProjectOpen(false);
                }
              }}
            />
            <div className="strata-home__new-project-actions">
              <button
                type="button"
                className="strata-home__new-project-cancel"
                onClick={() => {
                  setNewProjectName('');
                  setNewProjectOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="strata-home__new-project-confirm"
                disabled={!newProjectName.trim()}
                onClick={() => {
                  if (newProjectName.trim()) {
                    actions.createProject(
                      newProjectName.trim(),
                      view.activeWorkspaceId ?? undefined,
                    );
                    setNewProjectName('');
                    setNewProjectOpen(false);
                  }
                }}
              >
                Create
              </button>
            </div>
          </div>
        </Dialog>
        <BulkImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          platform={platform}
          onImportComplete={() => view.refresh()}
        />
      </section>
    </DndContext>
  );
}
