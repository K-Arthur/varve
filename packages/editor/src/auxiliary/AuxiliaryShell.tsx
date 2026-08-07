/**
 * Auxiliary window shell — minimal React component for panel-only windows.
 *
 * This shell:
 * 1. Reads window identity from URL params
 * 2. Registers with the session broker
 * 3. Receives and applies session snapshots
 * 4. Renders the hosted panel(s) from the dock tree
 * 5. Shows recovery/empty states
 *
 * Does NOT initialize: canvas, renderer, models, collaboration, full editor.
 */

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { AuxiliarySessionProvider, useAuxiliarySession } from './AuxiliaryProvider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuxiliaryWindowInfo {
  windowId: string;
  sessionId: string;
  panelTypeIds: string[];
  layout: unknown;
}

// ---------------------------------------------------------------------------
// URL parameter parsing
// ---------------------------------------------------------------------------

export function parseAuxiliaryWindowParams(url?: string): AuxiliaryWindowInfo | null {
  const params = new URLSearchParams(url ?? window.location.search);
  const surface = params.get('surface');
  if (surface !== 'panel-window') return null;

  const windowId = params.get('windowId');
  const sessionId = params.get('session');
  if (!windowId || !sessionId) return null;

  const panelTypes = params.get('panels')?.split(',').filter(Boolean) ?? [];

  return {
    windowId,
    sessionId,
    panelTypeIds: panelTypes,
    layout: null, // will be populated from snapshot
  };
}

// ---------------------------------------------------------------------------
// Panel renderer (stub — will be wired to real panels in M7+)
// ---------------------------------------------------------------------------

function PanelHost({ panelTypeId }: { panelTypeId: string }) {
  const { state, connected } = useAuxiliarySession();

  if (!connected) {
    return (
      <div style={styles.pending}>
        <div style={styles.pendingIcon}>...</div>
        <div>Connecting to editor session...</div>
      </div>
    );
  }

  return (
    <div style={styles.panelHost} data-panel-type={panelTypeId}>
      <div style={styles.panelHeader}>
        <span style={styles.panelTitle}>{panelTypeId}</span>
        <span style={styles.panelDoc}>{state.activeDocumentName || 'No document'}</span>
      </div>
      <div style={styles.panelContent}>
        <div style={styles.panelPlaceholder}>
          Panel "{panelTypeId}" will render here once wired to the real component.
          <br />
          <small>
            Document: {state.activeDocumentId || 'none'} | Selection: {state.selection.length} items
            | Mode: {state.workspaceMode}
          </small>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyAuxiliaryWindow() {
  return (
    <div style={styles.empty}>
      <div style={styles.emptyIcon}>[]</div>
      <h2 style={styles.emptyTitle}>No panels</h2>
      <p style={styles.emptyDescription}>
        Drag a panel here or use the Window menu to detach a panel into this window.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function AuxiliaryError({ error }: { error: string }) {
  return (
    <div style={styles.error}>
      <div style={styles.errorIcon}>!</div>
      <h2 style={styles.errorTitle}>Connection lost</h2>
      <p style={styles.errorDescription}>{error}</p>
      <button style={styles.errorButton} onClick={() => window.location.reload()} type="button">
        Reconnect
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recovery banner
// ---------------------------------------------------------------------------

function RecoveryBanner({
  onReattach,
  onGather,
}: {
  onReattach: () => void;
  onGather: () => void;
}) {
  return (
    <div style={styles.recoveryBanner} role="alert">
      <span>Some panels could not be restored.</span>
      <button style={styles.recoveryButton} onClick={onReattach} type="button">
        Reattach All
      </button>
      <button style={styles.recoveryButton} onClick={onGather} type="button">
        Gather Windows
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom title bar (minimal)
// ---------------------------------------------------------------------------

function AuxiliaryTitleBar({
  panelTypeIds,
  documentName,
}: {
  panelTypeIds: string[];
  documentName: string;
}) {
  return (
    <div style={styles.titleBar} data-tauri-drag-region>
      <div style={styles.titleBarLeft}>
        <span style={styles.titleBarIcon}>V</span>
        <span style={styles.titleBarText}>
          {panelTypeIds.length > 0 ? panelTypeIds.join(' + ') : 'Panel Window'}
          {documentName ? ` — ${documentName}` : ''}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main shell
// ---------------------------------------------------------------------------

export interface AuxiliaryShellProps {
  windowInfo: AuxiliaryWindowInfo;
}

export function AuxiliaryShell({ windowInfo }: AuxiliaryShellProps) {
  const [error, setError] = useState<string | null>(null);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const { state, connected } = useAuxiliarySession();

  // Register with session broker on mount
  useEffect(() => {
    const handlers = (window as unknown as Record<string, unknown>).__auxiliarySessionHandlers as
      | { onDisconnect?: () => void; onReload?: () => void }
      | undefined;

    const handleBeforeUnload = () => {
      // Notify primary window we're closing
      const w = window as unknown as Record<string, unknown>;
      const send = w.__sendToPrimary as ((eventId: string, payload: unknown) => void) | undefined;
      send?.('window-close', { kind: 'window-close', windowId: windowInfo.windowId });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      handlers?.onDisconnect?.();
    };
  }, [windowInfo.windowId]);

  // Handle connection loss
  useEffect(() => {
    if (!connected && state.lastRevision > 0) {
      setError('Lost connection to the primary editor window.');
    } else if (connected) {
      setError(null);
    }
  }, [connected, state.lastRevision]);

  if (error) {
    return <AuxiliaryError error={error} />;
  }

  return (
    <div style={styles.shell}>
      <AuxiliaryTitleBar
        panelTypeIds={windowInfo.panelTypeIds}
        documentName={state.activeDocumentName}
      />
      {needsRecovery && (
        <RecoveryBanner
          onReattach={() => setNeedsRecovery(false)}
          onGather={() => setNeedsRecovery(false)}
        />
      )}
      <div style={styles.panelArea}>
        {windowInfo.panelTypeIds.length > 0 ? (
          windowInfo.panelTypeIds.map((id) => <PanelHost key={id} panelTypeId={id} />)
        ) : (
          <EmptyAuxiliaryWindow />
        )}
      </div>
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
        layout: null,
      },
    [overrideInfo],
  );

  return (
    <AuxiliarySessionProvider>
      <AuxiliaryShell windowInfo={info} />
    </AuxiliarySessionProvider>
  );
}

// ---------------------------------------------------------------------------
// Styles (inline to avoid CSS import overhead in auxiliary windows)
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
    height: 32,
    padding: '0 12px',
    background: 'var(--color-surface-elevated, #f5f5f5)',
    borderBottom: '1px solid var(--color-border, #e0e0e0)',
    userSelect: 'none',
    flexShrink: 0,
  },
  titleBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  titleBarIcon: {
    fontWeight: 700,
    color: 'var(--color-accent, #3d9b8f)',
  },
  titleBarText: {
    fontSize: 12,
    opacity: 0.7,
  },
  panelArea: {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  panelHost: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid var(--color-border, #e0e0e0)',
    fontSize: 12,
    fontWeight: 600,
  },
  panelTitle: {},
  panelDoc: { fontWeight: 400, opacity: 0.6 },
  panelContent: { flex: 1, overflow: 'auto', padding: 12 },
  panelPlaceholder: {
    padding: 24,
    textAlign: 'center',
    opacity: 0.5,
    lineHeight: 1.6,
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    opacity: 0.5,
  },
  emptyIcon: { fontSize: 32, opacity: 0.3 },
  emptyTitle: { fontSize: 16, fontWeight: 600, margin: 0 },
  emptyDescription: { fontSize: 13, margin: 0, maxWidth: 300, textAlign: 'center' },
  error: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorIcon: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'var(--color-error, #e53935)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontWeight: 700,
  },
  errorTitle: { fontSize: 16, fontWeight: 600, margin: 0 },
  errorDescription: { fontSize: 13, margin: 0, opacity: 0.7 },
  errorButton: {
    marginTop: 8,
    padding: '6px 16px',
    border: '1px solid var(--color-border, #e0e0e0)',
    borderRadius: 6,
    background: 'var(--color-surface, #fff)',
    cursor: 'pointer',
    fontSize: 13,
  },
  pending: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    opacity: 0.5,
  },
  pendingIcon: { fontSize: 24 },
  recoveryBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: 'var(--color-warning-bg, #fff3e0)',
    borderBottom: '1px solid var(--color-warning-border, #ffb74d)',
    fontSize: 12,
  },
  recoveryButton: {
    padding: '2px 8px',
    border: '1px solid var(--color-border, #e0e0e0)',
    borderRadius: 4,
    background: 'var(--color-surface, #fff)',
    cursor: 'pointer',
    fontSize: 11,
  },
};
