import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addPage as addPageFn,
  duplicatePage,
  type NodeId,
  type Page,
  removePage,
  reorderPages,
} from '@strata/scene';
import { ContextMenu, type MenuEntry } from '@strata/ui';
import { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../context';
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
  onSelect,
  onContextMenu,
}: {
  page: Page;
  isActive: boolean;
  onSelect: (id: NodeId) => void;
  onContextMenu: (e: React.MouseEvent, id: NodeId) => void;
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
      onClick={() => onSelect(page.id)}
      onContextMenu={(e) => onContextMenu(e, page.id)}
      {...attributes}
      {...listeners}
      role="tab"
      tabIndex={isActive ? 0 : -1}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onSelect(page.id);
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
  const { state, updateDoc, setActivePage, setCurrentPageId } = useEditor();
  const pages = state.document.pages ?? [];
  const currentId = state.document.activePageId ?? state.currentPageId;

  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const [ctxPageId, setCtxPageId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleAddPage = useCallback(() => {
    const count = pages.length + 1;
    updateDoc((doc) => addPageFn(doc, { name: `Page ${count}` }));
    setCurrentPageId(null);
  }, [pages.length, updateDoc, setCurrentPageId]);

  const handleSelectPage = useCallback(
    (pageId: string) => {
      setActivePage(pageId);
      setCurrentPageId(pageId);
    },
    [setActivePage, setCurrentPageId],
  );

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

  const handleDeletePage = useCallback(() => {
    if (!ctxPageId) return;
    if (pages.length <= 1) return;
    updateDoc((doc) => removePage(doc, ctxPageId));
    closeContextMenu();
  }, [ctxPageId, pages.length, updateDoc, closeContextMenu]);

  const handleDuplicatePage = useCallback(() => {
    if (!ctxPageId) return;
    updateDoc((doc) => duplicatePage(doc, ctxPageId));
    closeContextMenu();
  }, [ctxPageId, updateDoc, closeContextMenu]);

  const ctxItems: MenuEntry[] = [
    { id: 'duplicate', label: 'Duplicate page', onAction: handleDuplicatePage },
    {
      id: 'delete',
      label: 'Delete page',
      onAction: handleDeletePage,
      disabled: pages.length <= 1,
    },
  ];

  if (pages.length === 0) return null;

  return (
    <div className="page-nav" ref={stripRef} role="tablist" aria-label="Page navigation">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={pages.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
          {pages.map((page) => (
            <SortablePageTab
              key={page.id}
              page={page}
              isActive={page.id === currentId}
              onSelect={handleSelectPage}
              onContextMenu={handleContextMenu}
            />
          ))}
        </SortableContext>
      </DndContext>
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
    </div>
  );
}
