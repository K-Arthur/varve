/**
 * PageStrip — horizontal scrollable page strip for the layers panel.
 *
 * Features:
 * - Thumbnails (60×40px) for each page
 * - Active page highlighted with accent border
 * - Click to switch active page
 * - Drag to reorder via @dnd-kit
 * - Add/duplicate/delete page buttons
 * - Context menu on right-click
 * - Cannot delete the last page
 * - Scrollable horizontally
 */

import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Document, NodeId, Page } from '@strata/scene';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './PageStrip.css';

interface PageStripProps {
  document: Document;
  activePageId: NodeId | undefined;
  onSetActivePage: (pageId: NodeId) => void;
  onAddPage: () => void;
  onDuplicatePage: (pageId: NodeId) => void;
  onDeletePage: (pageId: NodeId) => void;
  onReorderPages: (pageIds: NodeId[]) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  pageId: NodeId;
}

function SortablePage({
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
      className={`page-strip__page${isActive ? ' page-strip__page--active' : ''}`}
      aria-selected={isActive}
      aria-label={`Page: ${page.name}`}
      onClick={() => onSelect(page.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect(page.id);
      }}
      onContextMenu={(e) => onContextMenu(e, page.id)}
      {...attributes}
      {...listeners}
      role="tab"
      tabIndex={isActive ? 0 : -1}
    >
      <div className="page-strip__page-thumb" style={{ width: 60, height: 40 }}>
        <span className="page-strip__thumb-label">{page.name.charAt(0)}</span>
      </div>
      <span className="page-strip__page-label">{page.name}</span>
    </div>
  );
}

export function PageStrip({
  document: doc,
  activePageId,
  onSetActivePage,
  onAddPage,
  onDuplicatePage,
  onDeletePage,
  onReorderPages,
}: PageStripProps) {
  const pages: Page[] = (doc.pages ?? []) as Page[];
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = pages.findIndex((p) => p.id === active.id);
      const newIndex = pages.findIndex((p) => p.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const reordered = [...pages];
      const [moved] = reordered.splice(oldIndex, 1);
      if (!moved) return;
      reordered.splice(newIndex, 0, moved);

      onReorderPages(reordered.map((p) => p.id));
    },
    [pages, onReorderPages],
  );

  const handleSelect = useCallback(
    (pageId: NodeId) => {
      onSetActivePage(pageId);
    },
    [onSetActivePage],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, pageId: NodeId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, pageId });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const handleDuplicate = useCallback(() => {
    if (contextMenu) {
      onDuplicatePage(contextMenu.pageId);
      closeContextMenu();
    }
  }, [contextMenu, onDuplicatePage, closeContextMenu]);

  const handleDelete = useCallback(() => {
    if (contextMenu) {
      onDeletePage(contextMenu.pageId);
      closeContextMenu();
    }
  }, [contextMenu, onDeletePage, closeContextMenu]);

  const handleRename = useCallback(() => {
    if (contextMenu) {
      const page = pages.find((p) => p.id === contextMenu.pageId);
      if (page) {
        const newName = window.prompt('Rename page', page.name);
        if (newName?.trim()) {
          onSetActivePage(page.id);
        }
      }
      closeContextMenu();
    }
  }, [contextMenu, pages, onSetActivePage, closeContextMenu]);

  if (pages.length === 0) return null;

  const isLastPage = pages.length <= 1;

  return (
    <div className="page-strip" role="tablist" aria-label="Page navigation">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={pages.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
          <div className="page-strip__pages" ref={stripRef}>
            {pages.map((page) => (
              <SortablePage
                key={page.id}
                page={page}
                isActive={page.id === activePageId}
                onSelect={handleSelect}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button
        type="button"
        className="page-strip__add-btn"
        onClick={onAddPage}
        aria-label="Add page"
      >
        +
      </button>

      {contextMenu &&
        createPortal(
          <div
            className="page-strip__context-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              className="page-strip__context-item"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                handleDuplicate();
              }}
            >
              Duplicate page
            </button>
            <button
              type="button"
              className="page-strip__context-item"
              role="menuitem"
              disabled={isLastPage}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
            >
              Delete page
            </button>
            <button
              type="button"
              className="page-strip__context-item"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                handleRename();
              }}
            >
              Rename page
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
