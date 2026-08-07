/**
 * PagesPanel (M7) — first-class page management surface for the shared
 * multipage canvas.
 *
 * Virtualized page rows (windowed rendering — a 1,000-page document never
 * mounts 1,000 rows): thumbnail, name, display number, page side, master
 * assignment, section marker, and current-page highlight. Row actions:
 * navigate (click / Enter), duplicate, delete, move earlier / later — every
 * action is keyboard-reachable, so drag-and-drop equivalents can be layered
 * on later without a second interaction model.
 *
 * Thumbnails use the same engine pipeline as PageNav (lazy, cached per page
 * id, cancellable). Deletion uses the scene's delete-content policy — the
 * explicit content-disposition workflow is a later milestone.
 */

import type { NodeId } from '@varve/scene';
import {
  addPage as addPageDoc,
  computePageNumbering,
  duplicatePage as duplicatePageDoc,
  removePage as removePageDoc,
  reorderPages as reorderPagesDoc,
} from '@varve/scene';
import { Icon } from '@varve/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { usePageThumbnail } from '../PageNav/usePageThumbnail';
import { SectionCollapseToggle } from '../SectionCollapseToggle';
import './pages-panel.css';

/** Windowed-row budget: rows outside [first, last] are not rendered. */
const WINDOW = 30;
const ROW_HEIGHT = 64;

interface PageRowData {
  id: NodeId;
  name: string;
  number: string;
  side: string;
  masterName: string;
  sectionName: string;
}

export function PagesPanel() {
  const { state, updateDoc, setActivePage, setCurrentPageId, getPageSide } = useEditor();

  const doc = state.document;
  const pages = doc.pages ?? [];
  const masters = doc.masters ?? {};

  const [collapsed, setCollapsed] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedId, setFocusedId] = useState<NodeId | null>(null);
  const scrollRef = useRef<HTMLUListElement | null>(null);

  const numbering = useMemo(() => computePageNumbering(doc), [doc]);
  const orderedSections = useMemo(
    () => [...(doc.sections ?? [])].sort((a, b) => (a.startPageOrder < b.startPageOrder ? -1 : 1)),
    [doc.sections],
  );

  const rows: PageRowData[] = useMemo(
    () =>
      pages.map((page) => {
        const numberEntry = numbering.get(page.id);
        const master = page.masterPageId ? masters[page.masterPageId] : undefined;
        // A page belongs to the last section whose start order key precedes
        // its own order key.
        let sectionName = '';
        for (const s of orderedSections) {
          if (s.startPageOrder <= page.order) sectionName = s.name;
          else break;
        }
        return {
          id: page.id,
          name: page.name,
          number: numberEntry?.formatted ?? '',
          side: getPageSide(page.id),
          masterName: master?.name ?? '',
          sectionName,
        };
      }),
    [pages, numbering, masters, orderedSections, getPageSide],
  );

  const handleAddPage = useCallback(() => {
    updateDoc((doc) => addPageDoc(doc, { name: `Page ${doc.pages!.length + 1}` }));
    setCurrentPageId(null);
  }, [updateDoc, setCurrentPageId]);

  const handleDuplicate = useCallback(
    (pageId: NodeId) => {
      updateDoc((doc) => duplicatePageDoc(doc, pageId));
    },
    [updateDoc],
  );

  const handleDelete = useCallback(
    (pageId: NodeId) => {
      updateDoc((doc) => removePageDoc(doc, pageId));
      setCurrentPageId(null);
    },
    [updateDoc, setCurrentPageId],
  );

  const handleMove = useCallback(
    (pageId: NodeId, dir: -1 | 1) => {
      updateDoc((doc) => {
        const ids = (doc.pages ?? []).map((p) => p.id);
        const idx = ids.indexOf(pageId);
        const swapIdx = idx + dir;
        if (idx < 0 || swapIdx < 0 || swapIdx >= ids.length) return doc;
        const next = [...ids];
        const [moved] = next.splice(idx, 1);
        next.splice(swapIdx, 0, moved as NodeId);
        return reorderPagesDoc(doc, next);
      });
    },
    [updateDoc],
  );

  const handleNavigate = useCallback(
    (pageId: NodeId) => {
      setActivePage(pageId);
      setCurrentPageId(pageId);
    },
    [setActivePage, setCurrentPageId],
  );

  // Windowed slice of rows.
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - WINDOW);
  const last = Math.min(rows.length, Math.ceil((scrollTop + 600) / ROW_HEIGHT) + WINDOW);
  const visibleRows = rows.slice(first, last);

  // Roving tabindex: keep one focusable row.
  const tabIndexFor = useCallback(
    (id: NodeId) => (focusedId === null || focusedId === id ? 0 : -1),
    [focusedId],
  );

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
        if (next >= 0 && next < rows.length) {
          setFocusedId(rows[next]!.id);
          const el = scrollRef.current?.querySelector<HTMLElement>(
            `[data-page-row="${rows[next]!.id}"]`,
          );
          el?.focus({ preventScroll: false });
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleNavigate(rows[index]!.id);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        handleDelete(rows[index]!.id);
      }
    },
    [rows, handleNavigate, handleDelete],
  );

  // Scroll listener re-slices the window.
  const handleScroll = useCallback(() => {
    setScrollTop(scrollRef.current?.scrollTop ?? 0);
  }, []);

  if (state.workspaceMode !== 'design' && state.workspaceMode !== 'print') {
    return null;
  }

  return (
    <section className="pages-panel" aria-label="Pages">
      <div className="pages-panel__header">
        <h3 className="pages-panel__title">
          <SectionCollapseToggle
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            label="Pages section"
          />
          Pages
          <span className="pages-panel__count">{rows.length}</span>
        </h3>
        <button
          type="button"
          className="pages-panel__add-btn"
          onClick={handleAddPage}
          aria-label="Add page"
        >
          +
        </button>
      </div>
      {!collapsed && (
        <ul
          className="pages-panel__list"
          ref={scrollRef}
          onScroll={handleScroll}
          aria-label="Page list"
          style={{ height: Math.min(rows.length * ROW_HEIGHT, 320) }}
        >
          {visibleRows.map((row, i) => (
            <PageRow
              key={row.id}
              row={row}
              index={first + i}
              total={rows.length}
              active={row.id === doc.activePageId}
              tabIndex={tabIndexFor(row.id)}
              dataRowId={row.id}
              onNavigate={() => handleNavigate(row.id)}
              onDuplicate={() => handleDuplicate(row.id)}
              onDelete={() => handleDelete(row.id)}
              onMove={(dir) => handleMove(row.id, dir)}
              onKeyDown={handleRowKeyDown}
            />
          ))}
          {rows.length === 0 && (
            <p className="pages-panel__empty">No pages — click + to add one.</p>
          )}
        </ul>
      )}
    </section>
  );
}

interface PageRowProps {
  row: PageRowData;
  index: number;
  total: number;
  active: boolean;
  tabIndex: number;
  dataRowId: string;
  onNavigate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onKeyDown: (e: React.KeyboardEvent, index: number) => void;
}

function PageRow({
  row,
  index,
  total,
  active,
  tabIndex,
  dataRowId,
  onNavigate,
  onDuplicate,
  onDelete,
  onMove,
  onKeyDown,
}: PageRowProps) {
  const thumbnail = usePageThumbnail(row.id);
  return (
    <li
      className={`pages-panel__row${active ? ' pages-panel__row--active' : ''}`}
      data-page-row={dataRowId}
      tabIndex={tabIndex}
      aria-current={active ? 'page' : undefined}
      aria-label={`Page ${row.number || row.name}${row.side ? `, ${row.side} page` : ''}${row.masterName ? `, master ${row.masterName}` : ''}${active ? ', current page' : ''}`}
      onClick={onNavigate}
      onKeyDown={(e) => onKeyDown(e, index)}
      style={{ height: ROW_HEIGHT }}
    >
      <span className="pages-panel__thumb" aria-hidden>
        {thumbnail ? (
          <img src={thumbnail} alt="" />
        ) : (
          <span className="pages-panel__thumb-placeholder" />
        )}
      </span>
      <span className="pages-panel__meta">
        <span className="pages-panel__name">
          {row.name}
          {row.number && <span className="pages-panel__number">{row.number}</span>}
        </span>
        <span className="pages-panel__badges">
          {row.side && <span className="pages-panel__badge">{row.side}</span>}
          {row.masterName && <span className="pages-panel__badge">{row.masterName}</span>}
          {row.sectionName && (
            <span className="pages-panel__badge pages-panel__badge--section">
              {row.sectionName}
            </span>
          )}
        </span>
      </span>
      <span className="pages-panel__actions">
        <button
          type="button"
          className="pages-panel__icon-btn"
          aria-label={`Move ${row.name} earlier`}
          disabled={index === 0}
          onClick={(e) => {
            e.stopPropagation();
            onMove(-1);
          }}
        >
          <Icon name="ArrowUp" size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="pages-panel__icon-btn"
          aria-label={`Move ${row.name} later`}
          disabled={index === total - 1}
          onClick={(e) => {
            e.stopPropagation();
            onMove(1);
          }}
        >
          <Icon name="ArrowDown" size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="pages-panel__icon-btn"
          aria-label={`Duplicate ${row.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
        >
          <Icon name="Copy" size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="pages-panel__icon-btn pages-panel__icon-btn--danger"
          aria-label={`Delete ${row.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Icon name="X" size={12} aria-hidden />
        </button>
      </span>
    </li>
  );
}
