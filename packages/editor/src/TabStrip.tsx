/**
 * TabStrip — multi-document tab bar (A8 / F2).
 *
 * APG Tabs pattern: role=tablist / role=tab / aria-selected / roving tabindex
 * Arrow keys move focus (not selection); Enter/Space select; Delete closes.
 *
 * Each tab is a <div role="tab"> (not a <button>) so the inner close <button>
 * is valid HTML (interactive elements can't be nested inside <button>).
 *
 * Research basis: ARIA Authoring Practices Guide — Tabs pattern
 *   https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 */

import { AlertDialog, Tooltip } from '@strata/ui';
import { useRef, useState } from 'react';
import { useEditor } from './context';

function CloseIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" role="presentation">
      <line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" role="presentation">
      <line x1="5" y1="1" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function TabStrip({ onBackToHome: _onBackToHome }: { onBackToHome?: () => void }) {
  const { state, switchTab, closeTab, newTab } = useEditor();
  const { sessions, activeId } = state;
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  function getTabIds(): string[] {
    return sessions.map((s) => s.id);
  }

  function focusById(id: string) {
    tabRefs.current.get(id)?.focus();
  }

  function requestClose(id: string) {
    if (!closeTab(id)) {
      setConfirmCloseId(id);
    }
  }

  function handleTabKeyDown(e: React.KeyboardEvent, id: string) {
    const tabIds = getTabIds();
    const idx = tabIds.indexOf(id);
    if (idx < 0) return;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusById(tabIds[(idx + 1) % tabIds.length]!);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusById(tabIds[(idx - 1 + tabIds.length) % tabIds.length]!);
        break;
      case 'Home':
        e.preventDefault();
        if (tabIds.length > 0) focusById(tabIds[0]!);
        break;
      case 'End':
        e.preventDefault();
        if (tabIds.length > 0) focusById(tabIds[tabIds.length - 1]!);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        switchTab(id);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        requestClose(id);
        break;
    }
  }

  function handleAuxClick(e: React.MouseEvent, id: string) {
    if (e.button === 1) {
      e.preventDefault();
      requestClose(id);
    }
  }

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open documents">
      {sessions.map((sess) => {
        const isActive = sess.id === activeId;
        return (
          <Tooltip key={sess.id} label={sess.filePath ?? sess.name}>
            <div
              ref={(el) => {
                if (el) tabRefs.current.set(sess.id, el);
                else tabRefs.current.delete(sess.id);
              }}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`editor-tabs__tab${isActive ? ' editor-tabs__tab--active' : ''}`}
              onClick={() => switchTab(sess.id)}
              onKeyDown={(e) => handleTabKeyDown(e, sess.id)}
              onAuxClick={(e) => handleAuxClick(e, sess.id)}
            >
              {sess.dirty && <span className="editor-tabs__dirty-dot" aria-hidden="true" />}
              <span className="editor-tabs__name">{sess.name}</span>
              <button
                type="button"
                className="editor-tabs__close"
                aria-label={`Close ${sess.name}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  requestClose(sess.id);
                }}
              >
                <CloseIcon />
              </button>
            </div>
          </Tooltip>
        );
      })}
      <Tooltip label="New document" shortcut="Ctrl+T">
        <button
          type="button"
          className="editor-tabs__new"
          onClick={newTab}
          aria-label="New document (Ctrl+T)"
        >
          <PlusIcon />
        </button>
      </Tooltip>

      {(() => {
        if (!confirmCloseId) return null;
        const closeSess = sessions.find((s) => s.id === confirmCloseId);
        if (!closeSess) return null;
        return (
          <AlertDialog
            open={true}
            onClose={() => setConfirmCloseId(null)}
            onConfirm={() => {
              closeTab(confirmCloseId, true);
              setConfirmCloseId(null);
            }}
            title="Close document"
            description={`Close "${closeSess.name}"? Unsaved changes will be lost.`}
            confirmLabel="Close"
            variant="danger"
          />
        );
      })()}
    </div>
  );
}
