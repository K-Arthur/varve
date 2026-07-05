import { type MenuEntry, ContextMenu } from '@strata/ui';
import { addPage as addPageFn, duplicatePage, removePage, type Page } from '@strata/scene';
import { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../context';
import './pagenav.css';

function pageThumbnailStyle(page: Page) {
  const maxThumbH = 45;
  const aspect = page.width / page.height;
  const w = Math.round(maxThumbH * aspect);
  return { width: Math.max(40, Math.min(w, 90)), height: maxThumbH };
}

export function PageNav() {
  const { state, updateDoc, setCurrentPageId } = useEditor();
  const pages = state.document.pages ?? [];
  const currentId = state.currentPageId;

  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const [ctxPageId, setCtxPageId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const handleAddPage = useCallback(() => {
    const count = pages.length + 1;
    updateDoc((doc) => addPageFn(doc, { name: `Page ${count}` }));
    setCurrentPageId(null);
  }, [pages.length, updateDoc, setCurrentPageId]);

  const handleSelectPage = useCallback(
    (pageId: string) => {
      setCurrentPageId(pageId);
    },
    [setCurrentPageId],
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
      {pages.map((page) => {
        const isActive = page.id === currentId;
        return (
          <div
            key={page.id}
            className={`page-nav__item${isActive ? ' page-nav__item--active' : ''}`}
            role="tab"
            aria-selected={isActive}
            aria-label={`Page: ${page.name}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => handleSelectPage(page.id)}
            onContextMenu={(e) => handleContextMenu(e, page.id)}
          >
            <div className="page-nav__thumbnail" style={pageThumbnailStyle(page)}>
              <span className="page-nav__thumb-label">{page.name}</span>
            </div>
            <span className="page-nav__label">{page.name}</span>
          </div>
        );
      })}
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
