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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorProvider } from '../context';
import { PanelHostProvider } from '../workspace/PanelHostContext';
import '../workspace/bootstrap';
import { type PanelTypeId, tryGetPanelDefinition } from '../workspace/panelRegistry';
import { AuxiliarySessionProvider, useAuxiliarySession } from './AuxiliaryProvider';
import { renderAuxiliaryPanel } from './panelContentRegistry';

// ---------------------------------------------------------------------------
// URL parameter parsing
// ---------------------------------------------------------------------------

export interface AuxiliaryWindowInfo {
  windowId: string;
  sessionId: string;
  panelTypeIds: string[];
  /** Present only while a primary-originated detach is hydrating. */
  transactionId?: string;
  /** Canonical source-panel identity paired with `transactionId`. */
  panelInstanceId?: string;
  /** Reserved for a future reload/recovery coordinator. */
  generation?: number;
}

const AUXILIARY_ROUTE_ID = /^[A-Za-z0-9_-]{1,128}$/;
// Must stay congruent with @varve/platform's WorkspaceWindowId contract.
// This parser is deliberately a narrow route boundary and does not import a
// platform adapter just to validate untrusted URL text.
const WORKSPACE_WINDOW_ROUTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isAuxiliaryRouteId(value: string | null): value is string {
  return value !== null && AUXILIARY_ROUTE_ID.test(value);
}

function isWorkspaceWindowRouteId(value: string | null): value is string {
  return value !== null && WORKSPACE_WINDOW_ROUTE_ID.test(value);
}

export function parseAuxiliaryWindowParams(url?: string): AuxiliaryWindowInfo | null {
  const params = new URLSearchParams(url ?? window.location.search);
  const surface = params.get('surface');
  if (surface !== 'panel-window') return null;

  const windowId = params.get('windowId');
  const sessionId = params.get('session');
  const transactionId = params.get('transaction');
  const panelInstanceId = params.get('panelInstanceId');
  if (
    !isWorkspaceWindowRouteId(windowId) ||
    !isAuxiliaryRouteId(sessionId) ||
    !isAuxiliaryRouteId(transactionId) ||
    !isAuxiliaryRouteId(panelInstanceId)
  ) {
    return null;
  }

  const panelTypes = (params.get('panels') ?? '').split(',').filter(Boolean);
  // Model A admits one registered detachable panel per auxiliary window.
  // Reject a forged, grouped, or unsupported route before it even creates a
  // session transport; broker admission remains the second trust boundary.
  if (panelTypes.length !== 1 || !tryGetPanelDefinition(panelTypes[0] as PanelTypeId)?.detachable) {
    return null;
  }
  const rawGeneration = params.get('generation');
  if (rawGeneration !== null && !/^\d+$/.test(rawGeneration)) return null;
  const generation = rawGeneration === null ? undefined : Number(rawGeneration);
  if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 1))
    return null;

  return {
    windowId,
    sessionId,
    panelTypeIds: panelTypes,
    transactionId,
    panelInstanceId,
    ...(generation === undefined ? {} : { generation }),
  };
}

// ---------------------------------------------------------------------------
// Panel host
// ---------------------------------------------------------------------------

function PanelHost({ panelTypeId }: { panelTypeId: string }) {
  const content = useMemo(() => renderAuxiliaryPanel(panelTypeId), [panelTypeId]);
  const { state, acknowledgeHydration, reportHydrationFailure } = useAuxiliarySession();
  const rootRef = useRef<HTMLElement>(null);
  const restoredTransactionRef = useRef<string | null>(null);

  // The destination must have both a committed React subtree and its bounded
  // presentation state before it tells the primary that the source may hide.
  // This is intentionally a host effect, rather than a provider effect: the
  // lifecycle restores DOM-local panel state and therefore needs this root.
  useEffect(() => {
    const transfer = state.transfer;
    if (!transfer || transfer.panelTypeId !== panelTypeId) return;
    if (restoredTransactionRef.current === transfer.transactionId) return;

    const definition = tryGetPanelDefinition(panelTypeId as PanelTypeId);
    if (!content || !definition?.lifecycle?.restoreFromTransfer || !transfer.transferSnapshot) {
      reportHydrationFailure('The requested panel host cannot restore this transfer.');
      return;
    }

    let cancelled = false;
    void definition.lifecycle
      .restoreFromTransfer(transfer.transferSnapshot)
      .then(() => {
        if (cancelled) return;
        restoredTransactionRef.current = transfer.transactionId;
        acknowledgeHydration();
        // The new native window is focused by the coordinator after this
        // acknowledgement. Keep a meaningful local focus target ready.
        requestAnimationFrame(() => rootRef.current?.focus());
      })
      .catch(() => {
        if (!cancelled) {
          reportHydrationFailure('The panel state could not be restored safely.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [acknowledgeHydration, content, panelTypeId, reportHydrationFailure, state.transfer]);

  if (content === null) {
    return (
      <div role="alert" style={styles.unsupported}>
        <strong>{panelTypeId}</strong> is not supported in a panel window yet.
      </div>
    );
  }

  return (
    <section
      ref={rootRef}
      data-panel-root={panelTypeId}
      data-panel-type-id={panelTypeId}
      aria-labelledby={`auxiliary-panel-heading-${panelTypeId}`}
      tabIndex={-1}
      style={styles.panelHost}
    >
      <h1 id={`auxiliary-panel-heading-${panelTypeId}`} style={styles.visuallyHidden}>
        {panelTypeId} panel
      </h1>
      {content}
    </section>
  );
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

function InvalidRouteState() {
  return (
    <main aria-label="Panel window unavailable" style={styles.state}>
      <h1 style={styles.stateTitle}>Panel window unavailable</h1>
      <p style={styles.stateBody}>
        This panel window does not have a valid editor-session route. Return to the main window and
        detach the panel again.
      </p>
    </main>
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
    ({
      documentJson,
      baseDocumentRevision,
    }: {
      documentJson: string;
      baseDocumentRevision: number;
    }) => {
      send('aux-doc-changed', { documentJson, baseDocumentRevision });
    },
    [send],
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

  useEffect(() => {
    document.title = `${title} — Varve`;
  }, [title]);

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

      <main aria-label={`${title} panel window`} style={styles.main}>
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
                initialDocumentRevision={snapshot.documentRevision}
                externalState={state.externalState}
                onMutation={handleMutation}
                onSelectionChange={handleSelectionChange}
                disablePersistentHistory
                projectionMode
              >
                {panelTypeIds.map((panelTypeId) => (
                  <PanelHost key={panelTypeId} panelTypeId={panelTypeId} />
                ))}
              </EditorProvider>
            )}
          </div>
        )}
      </main>
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
  const info = useMemo(() => overrideInfo ?? parseAuxiliaryWindowParams(), [overrideInfo]);

  // Do not create a transport for a forged or incomplete route. The broker
  // independently validates every accepted host, but no untrusted page
  // should get as far as broadcasting a readiness message.
  if (!info) return <InvalidRouteState />;

  return (
    <AuxiliarySessionProvider
      windowId={info.windowId}
      sessionId={info.sessionId}
      panelTypeIds={info.panelTypeIds}
      transactionId={info.transactionId}
      panelInstanceId={info.panelInstanceId}
      generation={info.generation}
    >
      <PanelHostProvider windowId={info.windowId} isAuxiliary>
        <AuxiliaryShellInner info={info} />
      </PanelHostProvider>
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
  main: {
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
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
};
