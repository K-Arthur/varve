import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { contentHash, detectFileKind, type FileEntry, type Platform } from '@strata/platform';
import { generateKeyBetween } from '@strata/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyStates } from './EmptyStates';
import { FileContextMenu, type FileMenuAction } from './FileContextMenu';
import { FileGrid } from './FileGrid';
import { FileList } from './FileList';
import { HomeToolbar } from './HomeToolbar';
import { NewFileDialog } from './NewFileDialog';
import { ProjectsView } from './ProjectsView';
import { type SidebarEntry, SidebarNav } from './SidebarNav';
import { TemplatesGallery } from './TemplatesGallery';
import { TrashSection } from './TrashSection';
import { useFileActions } from './useFileActions';
import { type HomeShortcutHandlers, useHomeShortcuts } from './useHomeShortcuts';
import { useHomeView } from './useHomeView';
import { useThumbnailLoader } from './useThumbnailLoader';

export interface HomeShellProps {
  platform: Platform;
  onOpenFile: (entry: FileEntry) => void;
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

export function HomeShell({ platform, onOpenFile }: HomeShellProps) {
  const view = useHomeView(platform);
  const actions = useFileActions(platform, view.refresh);
  const thumbnails = useThumbnailLoader(platform);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [contextPos, setContextPos] = useState<{ x: number; y: number } | null>(null);
  const [contextFile, setContextFile] = useState<FileEntry | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    platform.listenForChanges(() => view.refresh()).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [platform, view]);

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
    selectAll: useCallback(() => {}, []),
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
    ...view.projects.map((p) => ({
      id: p.id,
      label: p.name,
      icon: 'Folder' as const,
      count: view.files.filter((f) => f.projectId === p.id).length,
      pinned: p.pinned,
    })),
    { id: 'templates', label: 'Templates', icon: 'LayoutGrid', count: 0 },
    { id: 'trash', label: 'Trash', icon: 'Archive', count: view.trashedFiles.length },
  ];

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const sensors = useSensors(pointerSensor);

  const filesByOrdering = useMemo(
    () => [...view.files].filter((f) => !f.trashedAt).sort((a, b) => (a.ordering || '') < (b.ordering || '') ? -1 : (a.ordering || '') > (b.ordering || '') ? 1 : 0),
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

  const handleContextAction = useCallback(
    (action: FileMenuAction) => {
      if (!contextFile) return;
      switch (action) {
        case 'open':
          onOpenFile(contextFile);
          break;
        case 'rename': {
          const name = prompt('Rename file:', contextFile.name);
          if (name) actions.rename(contextFile.id, name);
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
        case 'pin':
          actions.togglePin(contextFile);
          break;
      }
      setContextPos(null);
      setContextFile(null);
    },
    [contextFile, actions, onOpenFile, platform],
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
            onOpen={onOpenFile}
            onContext={handleFileContext}
            onRename={actions.renameProject}
            onDelete={actions.deleteProject}
          />
        ) : (
          <EmptyStates section="project" onAction={() => view.setSection('recent')} />
        );
      default:
        if (visibleFiles.length === 0 && !state.filter.query) {
          return <EmptyStates section={state.section} onAction={() => setNewFileOpen(true)} />;
        }
        if (visibleFiles.length === 0 && state.filter.query) {
          return (
            <EmptyStates
              section="search"
              query={state.filter.query}
              onAction={() => view.setFilter({ query: '' })}
            />
          );
        }
        return state.view === 'grid' ? (
          <FileGrid
            files={visibleFiles}
            thumbnails={thumbnails.thumbnails}
            onLoadThumbnail={thumbnails.load}
            onOpen={onOpenFile}
            onContext={handleFileContext}
            onFileDragStart={handleFileDragStart}
            selectedIds={[]}
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
          />
        );
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={undefined} onDragEnd={handleDragEnd}>
    <div
      className={`strata-home ${view.state.sidebarCollapsed ? 'strata-home--collapsed' : ''} ${isDragOver ? 'strata-home--drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {sidebarOpen && (
        <div
          className="drawer-overlay drawer-overlay--visible"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className={`strata-home__sidebar ${sidebarOpen ? 'strata-home__sidebar--open' : ''}`}>
        <SidebarNav
          entries={sidebarEntries}
          activeId={
            view.state.section === 'project'
              ? (view.state.activeProjectId ?? 'all')
              : view.state.section
          }
          onSelect={(id) => {
            if (['recent', 'all', 'templates', 'trash'].includes(id)) {
              view.setSection(id as 'recent' | 'all' | 'templates' | 'trash');
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
        />
      </div>
      <main className="strata-home__content">{renderContent()}</main>

      <NewFileDialog
        open={newFileOpen}
        onClose={() => setNewFileOpen(false)}
        onCreate={(preset) => {
          const id = crypto.randomUUID();
          const now = Date.now();
          const doc = {
            id,
            name: preset.name,
            rootChildren: [] as string[],
            nodes: {},
            components: {},
            nextId: 1,
          };
          const docJson = JSON.stringify(doc);
          const entry: FileEntry = {
            id,
            name: preset.name,
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
        />
      )}
    </div>
    </DndContext>
  );
}
