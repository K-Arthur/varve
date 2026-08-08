/**
 * Auxiliary window shell (ADR-0204/0206).
 *
 * A panel-only auxiliary window:
 * 1. Parses its identity (windowId, session, panels) from URL params
 * 2. Connects to the primary window's session broker
 * 3. Mounts a REAL EditorProvider hydrated from the session snapshot —
 *    editor-coupled panels (Layers, Inspector, ...) work unchanged; the
 *    provider's externalState/onMutation/onSelectionChange props bridge
 *    document + selection sync with the primary (single authority)
 * 4. Renders the hosted panel(s) via the panel content registry
 *
 * Deliberately NOT initialized: canvas, renderer, models, collaboration,
 * global shortcuts, dialogs. Panel-only windows stay lean.
 */

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EditorProvider } from '../context';
import { AuxiliarySessionProvider, useAuxiliarySession } from './AuxiliaryProvider';
import { renderAuxiliaryPanel } from './panelContentRegistry';

// ---------------------------------------------------------------------------
// URL parameter parsing
// ---------------------------------------------------------------------------

export interface AuxiliaryWindowInfo {
  windowId: string;
  sessionId: string;
  panelTypeIds: string[];
}

export function parseAuxiliaryWindowParams(url?: string): AuxiliaryWindowInfo | null {
  const params = new URLSearchParams(url ?? window.location.search);
  const surface = params.get('surface');
  if (surface !== 'panel-window') return null;

  const windowId = params.get('windowId');
  const sessionId = params.get('session');
  if (!windowId || !sessionId) return null;

  const panelTypes = (params.get('panels') ?? '').split(',').filter(Boolean);

  return { windowId, sessionId, panelTypeIds: panelTypes };
}

// ---------------------------------------------------------------------------
// Panel host
// ---------------------------------------------------------------------------

function PanelHost({ panelTypeId }: { panelTypeId: string }) {
  const content = useMemo(() => renderAuxiliaryPanel(panelTypeId), [panelTypeId]);

  if (content === null) {
    return (
      <div style={styles.unsupported}>
        <strong>{panelTypeId}</strong> is not supported in a panel window yet.
      </div>
    );
  }

  return <div style={styles.panelHost}>{content}</div>;
}

// ---------------------------------------------------------------------------
// Title bar
// ---------------------------------------------------------------------------

function AuxiliaryTitleBar({
  title,
  documentName,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onReattach,
}: {
  title: string;
  documentName: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReattach: () => void;
}) {
  return (
    <div style={styles.titleBar}>
      <span style={styles.titleIcon}>V</span>
      <span style={styles.titleText}>
        {title}
        {documentName ? ` — ${documentName}` : ''}
      </span>
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        data-testid="aux-undo"
        aria-label="Undo (routes to the main window's undo stack)"
        title="Undo (Ctrl+Z)"
        style={styles.undoBtn}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        data-testid="aux-redo"
        aria-label="Redo (routes to the main window's redo stack)"
        title="Redo (Ctrl+Shift+Z)"
        style={styles.undoBtn}
      >
        Redo
      </button>
      <button
        type="button"
        onClick={onReattach}
        data-testid="reattach-panel"
        aria-label={`Reattach ${title} to the main window`}
        style={styles.reattachBtn}
      >
        Reattach
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connecting / empty / error states
// ---------------------------------------------------------------------------

function ConnectingState() {
  return (
    <div style={styles.state}>
      <div style={styles.stateIcon}>...</div>
      <div>Connecting to editor session...</div>
    </div>
  );
}

function EmptyState({ onReattach }: { onReattach: () => void }) {
  return (
    <div style={styles.state}>
      <h2 style={styles.stateTitle}>No panels</h2>
      <p style={styles.stateBody}>Drag a panel here or detach one from the main window.</p>
      <button type="button" onClick={onReattach} style={styles.reattachBtn}>
        Reattach all
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main shell
// ---------------------------------------------------------------------------

function AuxiliaryShellInner({ info }: { info: AuxiliaryWindowInfo }) {
  const { state, panelTypeIds, reattach, send, requestUndo, requestRedo } = useAuxiliarySession();
  const [editorMounted, setEditorMounted] = useState(false);

  // Forward local mutations + selection upstream to the primary.
  const handleMutation = useCallback(
    (documentJson: string) => {
      send('aux-doc-changed', { windowId: info.windowId, documentJson });
    },
    [send, info.windowId],
  );

  const handleSelectionChange = useCallback(
    (selection: string[]) => {
      send('aux-selection-changed', { windowId: info.windowId, selection });
    },
    [send, info.windowId],
  );

  const snapshot = state.snapshot;
  const connected = state.connected;

  // Undo/redo shortcuts route to the primary window (the undo authority) —
  // exactly one undo/redo per keystroke across all windows.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        requestUndo();
      } else if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        requestRedo();
      } else if (key === 'y') {
        e.preventDefault();
        requestRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestUndo, requestRedo]);

  // Close this window when the primary removed its last panel.
  useEffect(() => {
    if (connected && panelTypeIds.length === 0) {
      window.close();
    }
  }, [connected, panelTypeIds.length]);

  // Mount the editor exactly once the first snapshot arrives.
  useEffect(() => {
    if (connected && snapshot && !editorMounted) {
      setEditorMounted(true);
    }
  }, [connected, snapshot, editorMounted]);

  const title =
    panelTypeIds.length > 0
      ? panelTypeIds.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')
      : 'Panel Window';

  return (
    <div style={styles.shell}>
      <AuxiliaryTitleBar
        title={title}
        documentName={snapshot?.activeDocumentName ?? ''}
        canUndo={snapshot?.canUndo ?? false}
        canRedo={snapshot?.canRedo ?? false}
        onUndo={requestUndo}
        onRedo={requestRedo}
        onReattach={reattach}
      />

      {!connected || !snapshot ? (
        <ConnectingState />
      ) : panelTypeIds.length === 0 ? (
        <EmptyState onReattach={reattach} />
      ) : (
        <div style={styles.content}>
          {editorMounted && (
            <EditorProvider
              initialDocumentJson={snapshot.documentJson}
              initialDocumentName={snapshot.activeDocumentName || undefined}
              externalState={state.externalState}
              onMutation={handleMutation}
              onSelectionChange={handleSelectionChange}
              disablePersistentHistory
            >
              {panelTypeIds.map((panelTypeId) => (
                <PanelHost key={panelTypeId} panelTypeId={panelTypeId} />
              ))}
            </EditorProvider>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

export interface AuxiliaryRootProps {
  /** Override for testing. */
  windowInfo?: AuxiliaryWindowInfo;
}

export function AuxiliaryRoot({ windowInfo: overrideInfo }: AuxiliaryRootProps = {}) {
  const info = useMemo(
    () =>
      overrideInfo ??
      parseAuxiliaryWindowParams() ?? {
        windowId: 'unknown',
        sessionId: 'unknown',
        panelTypeIds: [],
      },
    [overrideInfo],
  );

  return (
    <AuxiliarySessionProvider
      windowId={info.windowId}
      sessionId={info.sessionId}
      panelTypeIds={info.panelTypeIds}
    >
      <AuxiliaryShellInner info={info} />
    </AuxiliarySessionProvider>
  );
}

// ---------------------------------------------------------------------------
// Styles (inline — the auxiliary bundle does not load editor.css)
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    width: '100dvw',
    overflow: 'hidden',
    fontFamily: 'var(--font-family, system-ui, sans-serif)',
    fontSize: 'var(--font-size-sm, 13px)',
    color: 'var(--color-text, #1a1a1a)',
    background: 'var(--color-surface, #ffffff)',
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 34,
    padding: '0 12px',
    background: 'var(--color-surface-elevated, #f5f5f5)',
    borderBottom: '1px solid var(--color-border, #e0e0e0)',
    userSelect: 'none',
    flexShrink: 0,
  },
  titleIcon: { fontWeight: 700, color: 'var(--color-accent, #3d9b8f)' },
  titleText: {
    fontSize: 12,
    opacity: 0.75,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  reattachBtn: {
    padding: '3px 10px',
    border: '1px solid var(--color-border, #e0e0e0)',
    borderRadius: 5,
    background: 'var(--color-surface, #fff)',
    cursor: 'pointer',
    fontSize: 11,
  },
  undoBtn: {
    padding: '3px 8px',
    border: '1px solid var(--color-border, #e0e0e0)',
    borderRadius: 5,
    background: 'var(--color-surface, #fff)',
    cursor: 'pointer',
    fontSize: 11,
    opacity: 0.9,
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  panelHost: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 0,
  },
  state: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    opacity: 0.55,
  },
  stateIcon: { fontSize: 26 },
  stateTitle: { fontSize: 15, fontWeight: 600, margin: 0 },
  stateBody: { fontSize: 13, margin: 0, maxWidth: 300, textAlign: 'center' },
  unsupported: {
    padding: 24,
    textAlign: 'center',
    opacity: 0.6,
  },
};
