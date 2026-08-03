/**
 * TabStrip — multi-document tab bar (A8 / F2).
 *
 * APG Tabs pattern: role=tablist / role=tab / aria-selected / roving tabindex
 * Arrow keys move focus (not selection); Enter/Space select; Delete closes.
 *
 * Focus contract (docs/audits/focus-navigation-audit-2026-08-02.md):
 * - The roving tabindex follows FOCUS, not selection: the focused tab keeps
 *   tabindex=0, so Tab exits the widget from the focused tab (APG).
 * - Closing a tab moves focus to the replacement tab; creating a tab moves
 *   focus to the new tab; arrow focus scrolls the strip.
 *
 * Each tab is a <div role="tab"> (not a <button>) so the inner close <button>
 * is valid HTML (interactive elements can't be nested inside <button>).
 *
 * Research basis: ARIA Authoring Practices Guide — Tabs pattern
 *   https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 */

import { AlertDialog, Tooltip } from '@strata/ui';
import { useEffect, useRef, useState } from 'react';
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
  // Roving focus index: the tab that currently owns tabindex=0. Follows
  // focus moves; initialised to the active tab.
  const [focusId, setFocusId] = useState<string | null>(activeId);
  // Non-null when the session list is about to change and focus must move to
  // a specific position afterwards: the index of the tab being closed, or
  // Number.MAX_SAFE_INTEGER for the newly created (last) tab.
  const pendingFocusRef = useRef<number | null>(null);

  function getTabIds(): string[] {
    return sessions.map((s) => s.id);
  }

  function focusById(id: string) {
    const el = tabRefs.current.get(id);
    if (!el) return;
    setFocusId(id);
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function requestClose(id: string) {
    const idx = getTabIds().indexOf(id);
    pendingFocusRef.current = idx;
    if (!closeTab(id)) {
      setConfirmCloseId(id);
    }
  }

  // After the session list changes with a pending focus target, move focus
  // to the replacement position: the tab occupying the closed index (or the
  // last tab for a freshly created document).
  useEffect(() => {
    if (pendingFocusRef.current === null) return;
    const tabIds = getTabIds();
    const target = Math.min(pendingFocusRef.current, tabIds.length - 1);
    pendingFocusRef.current = null;
    if (target >= 0) {
      const el = tabRefs.current.get(tabIds[target]!);
      if (el) {
        setFocusId(tabIds[target]!);
        el.focus({ preventScroll: true });
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    }
  }, [sessions]);

  // Keep the roving index valid when tabs disappear through other paths.
  useEffect(() => {
    if (focusId && !sessions.some((s) => s.id === focusId)) {
      setFocusId(activeId);
    }
  }, [sessions, focusId, activeId]);

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

  const handleNewTab = () => {
    pendingFocusRef.current = Number.MAX_SAFE_INTEGER;
    newTab();
  };

  const rovingId = focusId ?? activeId;

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open documents">
      {sessions.map((sess) => {
        const isActive = sess.id === activeId;
        const isFocused = sess.id === rovingId;
        return (
          <Tooltip key={sess.id} label={sess.filePath ?? sess.name}>
            <div
              ref={(el) => {
                if (el) tabRefs.current.set(sess.id, el);
                else tabRefs.current.delete(sess.id);
              }}
              role="tab"
              aria-selected={isActive}
              tabIndex={isFocused ? 0 : -1}
              className={`editor-tabs__tab${isActive ? ' editor-tabs__tab--active' : ''}`}
              onClick={() => {
                setFocusId(sess.id);
                switchTab(sess.id);
              }}
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
          onClick={handleNewTab}
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
            onClose={() => {
              pendingFocusRef.current = null;
              setConfirmCloseId(null);
            }}
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
