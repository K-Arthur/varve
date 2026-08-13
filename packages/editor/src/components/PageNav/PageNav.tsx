import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addPage as addPageFn,
  deletePageWithPolicy,
  duplicatePage,
  type NodeId,
  type Page,
  renamePage,
  reorderPages,
} from '@varve/scene';
import { ContextMenu, type MenuEntry } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { applyThumbnailPreference } from '../../thumbnail/thumbnailCommands';
import { promptDialog } from '../PromptDialog';
import { usePageThumbnail } from './usePageThumbnail';
import './pagenav.css';

function pageThumbnailStyle(page: Page) {
  const maxThumbH = 40;
  const aspect = page.width / page.height;
  const w = Math.round(maxThumbH * aspect);
  return { width: Math.max(36, Math.min(w, 80)), height: maxThumbH };
}

/**
 * Compute the reordered list of page ids for a drag-and-drop move, or null
 * when the drop is a no-op (dropped on itself, or either id isn't a known
 * page — e.g. a stale drag event after pages changed mid-drag).
 */
export function computeReorderedPageIds(
  pages: Page[],
  activeId: NodeId,
  overId: NodeId,
): NodeId[] | null {
  const oldIndex = pages.findIndex((p) => p.id === activeId);
  const newIndex = pages.findIndex((p) => p.id === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;

  const ids = pages.map((p) => p.id);
  const [moved] = ids.splice(oldIndex, 1);
  ids.splice(newIndex, 0, moved as NodeId);
  return ids;
}

function SortablePageTab({
  page,
  isActive,
  isFocused,
  onSelect,
  onContextMenu,
  onNavigate,
}: {
  page: Page;
  isActive: boolean;
  isFocused: boolean;
  onSelect: (id: NodeId) => void;
  onContextMenu: (e: React.MouseEvent, id: NodeId) => void;
  onNavigate: (dir: 'next' | 'prev' | 'home' | 'end') => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const thumbnail = usePageThumbnail(page.id);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`page-nav__item${isActive ? ' page-nav__item--active' : ''}`}
      aria-selected={isActive}
      aria-label={`Page: ${page.name}`}
      data-page-id={page.id}
      onClick={() => onSelect(page.id)}
      onContextMenu={(e) => onContextMenu(e, page.id)}
      {...attributes}
      {...listeners}
      role="tab"
      tabIndex={isFocused ? 0 : -1}
      onKeyDown={(e) => {
        switch (e.key) {
          case 'ArrowRight':
            e.preventDefault();
            onNavigate('next');
            break;
          case 'ArrowLeft':
            e.preventDefault();
            onNavigate('prev');
            break;
          case 'Home':
            e.preventDefault();
            onNavigate('home');
            break;
          case 'End':
            e.preventDefault();
            onNavigate('end');
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            onSelect(page.id);
            break;
        }
      }}
    >
      <div className="page-nav__thumbnail" style={pageThumbnailStyle(page)}>
        {thumbnail ? (
          <img src={thumbnail} alt="" className="page-nav__thumb-img" />
        ) : (
          <span className="page-nav__thumb-label">{page.name}</span>
        )}
      </div>
      <span className="page-nav__label">{page.name}</span>
    </div>
  );
}

export function PageNav() {
  const { state, updateDoc, setActivePage, setCurrentPageId, platform, showToast } = useEditor();
  const pages = state.document.pages ?? [];
  const currentId = state.document.activePageId ?? state.currentPageId;
  const platformRef = useRef(platform);
  platformRef.current = platform;

  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const [ctxPageId, setCtxPageId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // Roving focus index: the page tab that owns tabindex=0. Follows focus
  // moves; initialised to the active page.
  const [focusId, setFocusId] = useState<string | null>(currentId);
  // Focus destination after a page-list change: 'active' (delete fallback)
  // or 'last' (new page).
  const pendingFocusRef = useRef<'active' | 'last' | null>(null);

  const pageEl = useCallback(
    (id: string): HTMLElement | null =>
      stripRef.current?.querySelector<HTMLElement>(`[data-page-id="${id}"]`) ?? null,
    [],
  );

  const focusPage = useCallback(
    (id: string, opts?: { scroll?: boolean }) => {
      setFocusId(id);
      const el = pageEl(id);
      if (el) {
        el.focus({ preventScroll: true });
        if (opts?.scroll !== false) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    },
    [pageEl],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleAddPage = useCallback(() => {
    const count = pages.length + 1;
    updateDoc((doc) => addPageFn(doc, { name: `Page ${count}` }));
    setCurrentPageId(null);
    pendingFocusRef.current = 'last';
  }, [pages.length, updateDoc, setCurrentPageId]);

  const handleSelectPage = useCallback(
    (pageId: string) => {
      setActivePage(pageId);
      setCurrentPageId(pageId);
    },
    [setActivePage, setCurrentPageId],
  );

  const handleNavigate = useCallback(
    (dir: 'next' | 'prev' | 'home' | 'end') => {
      if (pages.length === 0) return;
      const idx = pages.findIndex((p) => p.id === focusId);
      const base =
        idx < 0
          ? Math.max(
              0,
              pages.findIndex((p) => p.id === currentId),
            )
          : idx;
      let target: number;
      if (dir === 'home') target = 0;
      else if (dir === 'end') target = pages.length - 1;
      else target = (base + (dir === 'next' ? 1 : -1) + pages.length) % pages.length;
      const page = pages[target];
      if (!page) return;
      // Automatic activation: arrows switch the page (platform convention).
      handleSelectPage(page.id);
      focusPage(page.id);
    },
    [pages, focusId, currentId, handleSelectPage, focusPage],
  );

  // After a page-list change with a pending destination, move focus to the
  // replacement tab (delete fallback) or the new last tab (add).
  useEffect(() => {
    if (pendingFocusRef.current === null) return;
    const mode = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (mode === 'last') {
      const last = pages[pages.length - 1];
      if (last) focusPage(last.id);
    } else if (mode === 'active') {
      const id = currentId ?? pages[0]?.id;
      if (id) focusPage(id);
    }
  }, [pages, currentId, focusPage]);

  // Keep the roving index valid when pages disappear through other paths.
  useEffect(() => {
    if (focusId && !pages.some((p) => p.id === focusId)) {
      setFocusId(currentId ?? pages[0]?.id ?? null);
    }
  }, [pages, focusId, currentId]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const reordered = computeReorderedPageIds(pages, active.id as NodeId, over.id as NodeId);
      if (!reordered) return;
      updateDoc((doc) => reorderPages(doc, reordered));
    },
    [pages, updateDoc],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, pageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxPos({ x: e.clientX, y: e.clientY });
    setCtxPageId(pageId);
  }, []);

  const closeContextMenu = useCallback(() => {
    setCtxPos(null);
    setCtxPageId(null);
  }, []);

  // Deleting a page must not silently destroy work. A page's content can sit
  // outside its trim (staged on the pasteboard, placed for a bleed), where it
  // is invisible on the page yet still owned by it, so the default keeps the
  // content and only removes the page. Discarding content is a separate,
  // explicitly labelled command rather than a confirmation dialog.
  const handleDeletePage = useCallback(() => {
    if (!ctxPageId) return;
    pendingFocusRef.current = 'active';
    updateDoc((doc) => deletePageWithPolicy(doc, ctxPageId, 'move-to-pasteboard'));
    closeContextMenu();
  }, [ctxPageId, pages.length, updateDoc, closeContextMenu]);

  const handleDeletePageAndContents = useCallback(() => {
    if (!ctxPageId) return;
    pendingFocusRef.current = 'active';
    updateDoc((doc) => deletePageWithPolicy(doc, ctxPageId, 'delete-content'));
    closeContextMenu();
  }, [ctxPageId, pages.length, updateDoc, closeContextMenu]);

  const handleDuplicatePage = useCallback(() => {
    if (!ctxPageId) return;
    updateDoc((doc) => duplicatePage(doc, ctxPageId));
    closeContextMenu();
  }, [ctxPageId, updateDoc, closeContextMenu]);

  const handleRenamePage = useCallback(async () => {
    if (!ctxPageId) return;
    const page = pages.find((candidate) => candidate.id === ctxPageId);
    if (!page) return;
    closeContextMenu();
    const nextName = await promptDialog('Rename page', page.name);
    if (nextName === null || !nextName.trim()) return;
    updateDoc((doc) => renamePage(doc, ctxPageId, nextName));
  }, [ctxPageId, pages, updateDoc, closeContextMenu]);

  const ctxItems: MenuEntry[] = [
    { id: 'rename', label: 'Rename page', onAction: handleRenamePage },
    { id: 'duplicate', label: 'Duplicate page', onAction: handleDuplicatePage },
    {
      id: 'use-as-file-thumbnail',
      label: 'Use Page as File Thumbnail',
      onAction: () => {
        if (!ctxPageId) return;
        const fileId = state.sessions.find((s) => s.id === state.activeId)?.fileId;
        applyThumbnailPreference(
          {
            platform: platformRef.current!,
            document: state.document,
            selection: [],
            fileId,
            showToast: (opts) => showToast(opts),
          },
          { type: 'page', pageId: ctxPageId },
          'File thumbnail now shows this page',
        );
        closeContextMenu();
      },
      disabled:
        !platformRef.current || !state.sessions.some((s) => s.id === state.activeId && s.fileId),
    },
    {
      id: 'delete',
      label: 'Delete page (keep contents)',
      onAction: handleDeletePage,
    },
    {
      id: 'delete-with-contents',
      label: 'Delete page and contents',
      onAction: handleDeletePageAndContents,
      // Removing the final page returns the document to a plain canvas; the
      // scene layer forces content preservation in that case, so this can
      // never empty the document in one step.
      disabled: pages.length <= 1,
    },
  ];

  if (pages.length === 0) return null;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="page-nav" ref={stripRef} role="tablist" aria-label="Page navigation">
        <SortableContext items={pages.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
          {pages.map((page) => (
            <SortablePageTab
              key={page.id}
              page={page}
              isActive={page.id === currentId}
              isFocused={(focusId ?? currentId) === page.id}
              onSelect={handleSelectPage}
              onContextMenu={handleContextMenu}
              onNavigate={handleNavigate}
            />
          ))}
        </SortableContext>
      </div>
      <button
        type="button"
        className="page-nav__add-btn"
        onClick={handleAddPage}
        aria-label="Add page"
      >
        +
      </button>
      <ContextMenu
        items={ctxItems}
        position={ctxPos}
        onClose={closeContextMenu}
        label="Page context menu"
      />
    </DndContext>
  );
}
