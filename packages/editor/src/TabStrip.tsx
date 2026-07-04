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
import { StrataLogo } from '@strata/ui';
import { useRef } from 'react';
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

const HOME_ID = '__home__';

export function TabStrip({ onBackToHome }: { onBackToHome?: () => void }) {
  const { state, switchTab, closeTab, newTab } = useEditor();
  const { sessions, activeId } = state;
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  function getTabIds(): string[] {
    return [HOME_ID, ...sessions.map((s) => s.id)];
  }

  function focusById(id: string) {
    tabRefs.current.get(id)?.focus();
  }

  function requestClose(id: string) {
    const sess = sessions.find((s) => s.id === id);
    if (!closeTab(id)) {
      if (confirm(`Close "${sess?.name ?? 'Untitled'}"? Unsaved changes will be lost.`)) {
        closeTab(id, true);
      }
    }
  }

  function handleTabKeyDown(e: React.KeyboardEvent, id: string) {
    const tabIds = getTabIds();
    const idx = tabIds.indexOf(id);
    if (idx < 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = tabIds[(idx + 1) % tabIds.length];
      if (next) focusById(next);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = tabIds[(idx - 1 + tabIds.length) % tabIds.length];
      if (prev) focusById(prev);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (id === HOME_ID) {
        onBackToHome?.();
      } else {
        switchTab(id);
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (id === HOME_ID) return;
      e.preventDefault();
      requestClose(id);
    }
  }

  function handleAuxClick(e: React.MouseEvent, id: string) {
    if (e.button === 1) {
      e.preventDefault();
      if (id !== HOME_ID) requestClose(id);
    }
  }

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open documents">
      {/* Home tab */}
      <div
        key={HOME_ID}
        ref={(el) => {
          if (el) tabRefs.current.set(HOME_ID, el);
          else tabRefs.current.delete(HOME_ID);
        }}
        role="tab"
        aria-selected={false}
        tabIndex={0}
        className="editor-tabs__tab editor-tabs__tab--home"
        onClick={() => onBackToHome?.()}
        onKeyDown={(e) => handleTabKeyDown(e, HOME_ID)}
        onAuxClick={(e) => handleAuxClick(e, HOME_ID)}
        title="Home (Ctrl+Shift+H)"
      >
        <StrataLogo size={14} />
        <span className="editor-tabs__name">Home</span>
      </div>
      {sessions.map((sess) => {
        const isActive = sess.id === activeId;
        return (
          <div
            key={sess.id}
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
            title={sess.filePath ?? sess.name}
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
        );
      })}
      <button
        type="button"
        className="editor-tabs__new"
        onClick={newTab}
        aria-label="New document (Ctrl+T)"
        title="New document (Ctrl+T)"
      >
        <PlusIcon />
      </button>
    </div>
  );
}
