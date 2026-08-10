import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  contentHash,
  detectFileKind,
  type FileEntry,
  type Platform,
  type SavedSearch,
  type TemplateLibrary,
} from '@varve/platform';
import { createNewDocument, type NewDocumentRequest, serializeDocument } from '@varve/scene';
import {
  BLANK_DOCUMENT_PRESET,
  ENCRYPTED_PROJECT_PLACEHOLDER,
  generateKeyBetween,
  nextUntitledName,
  type Preset,
} from '@varve/shared';
import { ContentSkeleton, Dialog, Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityFeed } from './ActivityFeed';
import { AssetBrowser } from './AssetBrowser';
import { BatchActions } from './BatchActions';
import { BreadcrumbNav, type BreadcrumbSegment } from './BreadcrumbNav';
import { BulkImportDialog } from './BulkImportDialog';
import { EmptyStates } from './EmptyStates';
import { FileContextMenu, type FileMenuAction } from './FileContextMenu';
import { FileGrid } from './FileGrid';
import { FileList } from './FileList';
import { HomeSearchPalette } from './HomeSearchPalette';
import { HomeShortcutHelp } from './HomeShortcutHelp';
import { HomeToolbar } from './HomeToolbar';
import { NewDesignDialog } from './NewDesignDialog';
import { PerfProfile } from './PerfProfile';
import { ProjectsView } from './ProjectsView';
import { usePresetLibrary } from './presetLibrary';
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
  /** Re-link a Home entry whose physical file was moved or renamed (Locate).
   *  Implementations open a native picker, verify the candidate's document
   *  identity, rebind the entry's path, and resolve true on success. When
   *  omitted, Locate falls back to revealing the (broken) path. */
  onLocateFile?: (entry: FileEntry) => Promise<boolean>;
  /** When an editor session is alive behind the home screen, lets the user
   *  jump back to it without reopening a file. */
  onResumeEditing?: () => void;
  /** Called once the home screen has finished loading its initial data. */
  onReady?: () => void;
  /** When true, home is the visible surface (refresh when becoming active). */
  active?: boolean;
}

export function HomeShell({
  platform,
  onOpenFile,
  onLocateFile,
  onResumeEditing,
  onReady,
  active = true,
}: HomeShellProps) {
  const view = useHomeView(platform);
  const readyFired = useRef(false);
  const wasActiveRef = useRef(active);
  // Must be performance.now() (nav-relative), not Date.now() (epoch) —
  // PerfProfile subtracts from performance.now(). Capture once on mount.
  const renderStartRef = useRef(performance.now());

  useEffect(() => {
    if (!view.loading && !readyFired.current) {
      readyFired.current = true;
      onReady?.();
    }
  }, [view.loading, onReady]);

  // Refresh file list when returning from the editor so Recents/Favourites
  // reflect touchFile + any save metadata updates.
  useEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (becameActive) {
      void view.refresh();
    }
  }, [active, view.refresh]);
  const actions = useFileActions(platform, view.refresh);
  const thumbnails = useThumbnailLoader(platform);
  // Encrypted files never display cached pixels: their cards are forced to
  // the content-free encrypted placeholder regardless of cache state.
  const displayThumbnails = useMemo(() => {
    const map = thumbnails.thumbnails;
    const encryptedIds = view.recentRecords.filter((r) => r.encrypted).map((r) => r.id);
    if (encryptedIds.length === 0) return map;
    const next = new Map(map);
    for (const id of encryptedIds) next.set(id, ENCRYPTED_PROJECT_PLACEHOLDER);
    return next;
  }, [thumbnails.thumbnails, view.recentRecords]);
  const presetLibrary = usePresetLibrary(platform);

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
  const [templates, setTemplates] = useState<TemplateLibrary[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<string | null>(null);
  const [saveSearchDialogOpen, setSaveSearchDialogOpen] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderBreadcrumb, setFolderBreadcrumb] = useState<BreadcrumbSegment[]>([]);

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

  // Reset folder state when switching to a different project
  useEffect(() => {
    setFolderId(null);
    setFolderBreadcrumb([]);
  }, []);

  useEffect(() => {
    platform
      .listTemplates()
      .then((list) => setTemplates(list))
      .catch(() => setTemplates([]));
  }, [platform]);

  useEffect(() => {
    platform
      .listSavedSearches()
      .then(setSavedSearches)
      .catch(() => setSavedSearches([]));
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
      if (result) {
        const entry = result.entry;
        // Persist the store copy (with the resolved disk path) so the
        // editor's File → Save writes back to the original location
        // (Figma/Photoshop behavior), not just the app store.
        if (result.filePath) {
          entry.filePath = result.filePath;
        }
        await platform.upsertFile(entry, result.documentJson).catch(() => undefined);
        onOpenFile(entry);
      }
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
    toggleFavorite: useCallback(() => {
      if (selectedIds.length === 0) {
        const firstFile = view.visibleFiles[0];
        if (firstFile) actions.toggleFavorite(firstFile);
      } else {
        for (const id of selectedIds) {
          const entry = view.files.find((f) => f.id === id);
          if (entry) actions.toggleFavorite(entry);
        }
      }
    }, [selectedIds, view, actions]),
  };
  useHomeShortcuts(shortcutHandlers, dialogOpen);

  const sidebarEntries: SidebarEntry[] = [
    { id: 'recent', label: 'Recent', icon: 'Clock', count: view.recentSectionCounts.all },
    {
      id: 'all',
      label: 'All Files',
      icon: 'FileText',
      count: view.files.length - view.trashedFiles.length,
    },
    { id: 'drafts', label: 'Drafts', icon: 'Pen' as const, count: view.draftFiles.length },
    {
      id: 'favorites',
      label: 'Favorites',
      icon: 'Star' as const,
      count: view.favoriteFiles.length,
    },
    ...view.projects.map((p) => ({
      id: p.id,
      label: p.name,
      icon: 'Folder' as const,
      count: view.files.filter((f) => f.projectId === p.id).length,
      pinned: p.pinned,
    })),
    { id: 'templates', label: 'Templates', icon: 'GridFour', count: 0 },
    { id: 'assets', label: 'Assets', icon: 'Image', count: 0 },
    { id: 'activity', label: 'Activity', icon: 'ClockCounterClockwise', count: 0 },
    { id: 'trash', label: 'Trash', icon: 'Archive', count: view.trashedFiles.length },
  ];

  const sidebarSectionCounts: Record<string, number> = {
    recent: view.recentSectionCounts.all,
    all: view.files.length - view.trashedFiles.length,
    drafts: view.draftFiles.length,
    favorites: view.favoriteFiles.length,
    templates: 0,
    assets: 0,
    activity: 0,
    trash: view.trashedFiles.length,
  };

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
        case 'favorite':
          actions.toggleFavorite(contextFile);
          break;
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
          if (onLocateFile) {
            void onLocateFile(contextFile).then((ok) => {
              if (ok) view.refresh();
            });
          } else if (contextFile.filePath) {
            platform.revealInFileManager(contextFile.filePath);
          }
          break;
        }
        case 'remove': {
          actions.purge(contextFile.id);
          break;
        }
        case 'hide':
          platform.patchRecentFile(contextFile.id, { hidden: true }).then(() => view.refresh());
          break;
        case 'unhide':
          platform.patchRecentFile(contextFile.id, { hidden: false }).then(() => view.refresh());
          break;
      }
      setContextPos(null);
      setContextFile(null);
    },
    [contextFile, actions, onOpenFile, onLocateFile, platform, handleStartRename, view.refresh],
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

  // Create a document from a canonical creation request and open it. Shared
  // by the New Design dialog and the home quick-start row; every creation
  // path funnels through @varve/scene's createNewDocument so behavior is
  // identical (empty document vs. initial-frame preset vs. template).
  const createDocumentFromRequest = useCallback(
    async (request: NewDocumentRequest) => {
      const created = createNewDocument(request);
      if (!created.ok) return;
      const doc = created.result.document;
      const id = crypto.randomUUID();
      const now = Date.now();
      const docJson = serializeDocument(doc);
      const entry: FileEntry = {
        id,
        name: doc.name,
        kind: 'strata',
        projectId: null,
        createdAt: now,
        updatedAt: now,
        openedAt: now,
        size: docJson.length,
        pinned: false,
        trashedAt: null,
        ordering: '',
        contentHash: contentHash(docJson),
      };
      // Await the persistence so readFile in handleOpenFile always finds the
      // document. Without this await, readFile races with upsertFile and may
      // return null, causing a blank document to appear instead of the content.
      await platform.upsertFile(entry, docJson).catch(() => undefined);
      onOpenFile(entry);
    },
    [platform, onOpenFile],
  );

  // Create a document from a preset (blank or print) and open it — used by
  // the quick-start row and the dialog's frame-preset path.
  const createFromPreset = useCallback(
    (preset: Preset, documentName?: string) => {
      const name =
        documentName?.trim() ||
        nextUntitledName(
          view.files.map((f) => f.name),
          'Untitled',
        );
      void createDocumentFromRequest({
        documentName: name,
        startMode:
          preset.id === BLANK_DOCUMENT_PRESET.id
            ? 'empty'
            : preset.colorMode === 'cmyk'
              ? 'pages'
              : 'framePreset',
        preset,
      });
    },
    [createDocumentFromRequest, view.files],
  );

  const createEmptyOrCustom = useCallback(
    (request: NewDocumentRequest) => {
      void createDocumentFromRequest(request);
    },
    [createDocumentFromRequest],
  );

  const createFromTemplateRequest = useCallback(
    (request: NewDocumentRequest) => {
      void createDocumentFromRequest(request);
    },
    [createDocumentFromRequest],
  );

  const handleBreadcrumbNavigate = useCallback(
    (id: string) => {
      if (view.workspaces.some((w) => w.id === id) || id === 'personal') {
        view.setActiveProject(null);
        view.setSection('all');
        setFolderId(null);
        return;
      }
      if (view.projects.some((p) => p.id === id)) {
        view.setActiveProject(id);
        setFolderId(null);
        return;
      }
      setFolderId(id);
    },
    [view],
  );

  const renderContent = () => {
    if (view.loading) {
      return (
        <div className="varve-home">
          <div className="varve-home__sidebar">
            <ContentSkeleton variant="list" rows={5} label="Loading navigation" />
          </div>
          <div className="varve-home__content">
            <ContentSkeleton variant="grid" columns={4} rows={2} label="Loading projects" />
          </div>
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
      case 'project': {
        const activeProject = projects.find((p) => p.id === state.activeProjectId) ?? null;
        if (!activeProject) {
          return <EmptyStates section="project" onAction={() => view.setSection('recent')} />;
        }
        const activeWsName =
          view.workspaces.find((w) => w.id === view.activeWorkspaceId)?.name ?? 'Personal';
        const activeWsId = view.activeWorkspaceId ?? 'personal';
        const breadcrumbPath: BreadcrumbSegment[] = [
          { id: activeWsId, name: activeWsName },
          { id: activeProject.id, name: activeProject.name },
          ...folderBreadcrumb,
        ];
        return (
          <>
            <BreadcrumbNav path={breadcrumbPath} onNavigate={handleBreadcrumbNavigate} />
            <ProjectsView
              project={activeProject}
              files={visibleFiles}
              thumbnails={displayThumbnails}
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
              activeFolderId={folderId}
              onSetFolderId={setFolderId}
              onFolderBreadcrumb={setFolderBreadcrumb}
            />
          </>
        );
      }
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
        return (
          <>
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
                thumbnails={displayThumbnails}
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
                onToggleFavorite={actions.toggleFavorite}
              />
            ) : (
              <FileList
                files={visibleFiles}
                thumbnails={displayThumbnails}
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
                onToggleFavorite={actions.toggleFavorite}
                onPin={actions.togglePin}
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
        className={`varve-home ${view.state.sidebarCollapsed ? 'varve-home--collapsed' : ''} ${isDragOver ? 'varve-home--drag-over' : ''}`}
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
        <div className={`varve-home__sidebar ${sidebarOpen ? 'varve-home__sidebar--open' : ''}`}>
          {onResumeEditing && (
            <Tooltip label="Return to your open tabs">
              <button type="button" className="sidebar-resume" onClick={onResumeEditing}>
                <Icon name="ArrowLeft" label={undefined} size="1em" />
                <span>Continue editing</span>
              </button>
            </Tooltip>
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
            sectionCounts={sidebarSectionCounts}
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
                setActiveSavedSearchId(null);
              } else {
                const savedSearch = savedSearches.find((s) => s.id === id);
                if (savedSearch) {
                  view.setFilter({
                    query: savedSearch.query,
                    kinds: savedSearch.kinds ?? [],
                    tagIds: savedSearch.tagIds ?? [],
                  });
                  setActiveSavedSearchId(id);
                  view.setSection('all');
                } else {
                  view.setActiveProject(id);
                  setActiveSavedSearchId(null);
                }
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
            savedSearches={savedSearches}
            activeSavedSearchId={activeSavedSearchId}
            onDeleteSavedSearch={async (id) => {
              await platform.deleteSavedSearch(id);
              setSavedSearches((prev) => prev.filter((s) => s.id !== id));
              if (activeSavedSearchId === id) {
                setActiveSavedSearchId(null);
              }
            }}
            searchQuery={view.state.filter.query}
            onSearchQueryChange={(q) => {
              view.setFilter({ query: q });
              setActiveSavedSearchId(null);
            }}
            searchResultCount={view.visibleFiles.length}
          />
        </div>
        <div className="varve-home__toolbar">
          <HomeToolbar
            sidebarCollapsed={view.state.sidebarCollapsed}
            onToggleSidebar={view.toggleSidebar}
            viewMode={view.state.view}
            onViewModeChange={view.setView}
            sortKey={view.state.sort.key}
            sortDirection={view.state.sort.direction}
            onSortKeyChange={view.setSortKey}
            onSortDirToggle={view.toggleSortDir}
            onNewFile={() => setNewFileOpen(true)}
            onOpenFromDisk={async () => {
              const result = await platform.openDocumentFromDisk();
              if (result) {
                if (result.filePath) result.entry.filePath = result.filePath;
                await platform.upsertFile(result.entry, result.documentJson).catch(() => undefined);
                onOpenFile(result.entry);
              }
            }}
            kindFilter={view.state.filter.kinds}
            pinnedOnly={view.state.filter.pinnedOnly}
            dateFrom={view.state.filter.dateFrom}
            dateTo={view.state.filter.dateTo}
            onKindFilterChange={(kinds) => {
              view.setFilter({ kinds });
              setActiveSavedSearchId(null);
            }}
            onPinnedOnlyChange={(pinnedOnly) => {
              view.setFilter({ pinnedOnly });
              setActiveSavedSearchId(null);
            }}
            onDateFromChange={(dateFrom) => {
              view.setFilter({ dateFrom });
              setActiveSavedSearchId(null);
            }}
            onDateToChange={(dateTo) => {
              view.setFilter({ dateTo });
              setActiveSavedSearchId(null);
            }}
            onClearFilters={() => {
              view.setFilter({ kinds: [], pinnedOnly: false, dateFrom: null, dateTo: null });
              setActiveSavedSearchId(null);
            }}
            section={view.state.section}
            recentWorkspaceFilter={view.recentWorkspaceFilter}
            onRecentWorkspaceFilterChange={view.setRecentWorkspaceFilter}
          />
        </div>
        {selectedIds.length > 0 && (
          <div className="varve-home__batch-bar">
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
        <main id="home-main" tabIndex={-1} className="varve-home__content">
          {renderContent()}
          <PerfProfile
            fileCount={view.files.length}
            renderStartTime={renderStartRef.current}
            searchResultCount={view.visibleFiles.length}
          />
        </main>

        <NewDesignDialog
          open={newFileOpen}
          onClose={() => setNewFileOpen(false)}
          defaultName={nextUntitledName(
            view.files.map((f) => f.name),
            'Untitled',
          )}
          onCreate={(request) => {
            if (request.startMode === 'template' && request.templateJson) {
              createFromTemplateRequest(request);
            } else if (request.startMode === 'framePreset' && request.preset) {
              createFromPreset(request.preset, request.documentName);
            } else {
              createEmptyOrCustom(request);
            }
            setNewFileOpen(false);
          }}
          customPresets={presetLibrary.customPresets}
          favoriteIds={presetLibrary.favoriteIds}
          recentIds={presetLibrary.recentIds}
          onToggleFavoritePreset={(preset) => presetLibrary.toggleFavorite(preset.id)}
          onRecordRecentPreset={(preset) => presetLibrary.recordRecent(preset.id)}
          onSaveCustomPreset={presetLibrary.addCustomPreset}
          onEditCustomPreset={(preset) => {
            const name = window.prompt('Rename preset', preset.name);
            if (name && name !== preset.name) presetLibrary.updateCustomPreset(preset.id, { name });
          }}
          onDuplicateCustomPreset={(preset) => presetLibrary.duplicateCustomPreset(preset.id)}
          onDeleteCustomPreset={(preset) => presetLibrary.deleteCustomPreset(preset.id)}
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
            isHidden={view.recentRecords.some((r) => r.id === contextFile.id && r.hidden)}
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
          platform={platform}
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
          <div className="varve-home__new-project-dialog">
            <label htmlFor="new-project-name" className="varve-home__new-project-label">
              Project name
            </label>
            <input
              id="new-project-name"
              type="text"
              className="varve-home__new-project-input"
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
            <div className="varve-home__new-project-actions">
              <button
                type="button"
                className="varve-home__new-project-cancel"
                onClick={() => {
                  setNewProjectName('');
                  setNewProjectOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="varve-home__new-project-confirm"
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
        <Dialog
          open={saveSearchDialogOpen}
          title="Save Search"
          onClose={() => setSaveSearchDialogOpen(false)}
        >
          <div className="varve-home__new-project-dialog">
            <label htmlFor="save-search-name" className="varve-home__new-project-label">
              Search name
            </label>
            <input
              id="save-search-name"
              type="text"
              className="varve-home__new-project-input"
              placeholder="e.g. Recent logos"
              value={saveSearchName}
              onChange={(e) => setSaveSearchName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveSearchName.trim()) {
                  platform
                    .createSavedSearch(
                      saveSearchName.trim(),
                      view.state.filter.query,
                      view.state.filter.kinds,
                      view.state.filter.tagIds,
                    )
                    .then((s) => {
                      setSavedSearches((prev) => [...prev, s]);
                      setSaveSearchDialogOpen(false);
                      setSaveSearchName('');
                    });
                }
                if (e.key === 'Escape') {
                  setSaveSearchDialogOpen(false);
                  setSaveSearchName('');
                }
              }}
            />
            <div className="varve-home__new-project-actions">
              <button
                type="button"
                className="varve-home__new-project-cancel"
                onClick={() => {
                  setSaveSearchDialogOpen(false);
                  setSaveSearchName('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="varve-home__new-project-confirm"
                disabled={!saveSearchName.trim()}
                onClick={() => {
                  if (saveSearchName.trim()) {
                    platform
                      .createSavedSearch(
                        saveSearchName.trim(),
                        view.state.filter.query,
                        view.state.filter.kinds,
                        view.state.filter.tagIds,
                      )
                      .then((s) => {
                        setSavedSearches((prev) => [...prev, s]);
                        setSaveSearchDialogOpen(false);
                        setSaveSearchName('');
                      });
                  }
                }}
              >
                Save
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
