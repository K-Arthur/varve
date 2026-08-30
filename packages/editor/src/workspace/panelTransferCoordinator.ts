/**
 * Transactional detach coordinator for one auxiliary panel window.
 *
 * The React drag/button affordance is deliberately not allowed to decide
 * ownership. This coordinator allocates the canonical window identity,
 * captures bounded local state, waits for the auxiliary host to hydrate, and
 * only then changes the detached-panel store (which hides the source UI).
 */

import { getWindowService, type NativeWindowService, type WindowPlacement } from '@varve/platform';
import {
  type DetachedPanelRecord,
  getDetachedPanel,
  markPanelDetached,
} from './detachedPanelsStore';
import {
  getPanelDefinition,
  type PanelDefinition,
  type PanelTransferSnapshot,
  type PanelTypeId,
} from './panelRegistry';
import { recordPanelWindowDiagnostic } from './panelWindowDiagnostics';
import { createPanelWindowId, getPanelWindowSessionId } from './panelWindowSession';
import { getSessionBroker } from './sessionBroker';
import { TransferStateMachine } from './transferStateMachine';
import { loadPanelPlacement, restorePanelPlacement } from './workspaceManager';

export type PanelTransferFailureCode =
  | 'unsupported'
  | 'not-detachable'
  | 'invalid-transfer-state'
  | 'host-unavailable'
  | 'destination-failed';

export class PanelTransferError extends Error {
  readonly code: PanelTransferFailureCode;

  constructor(code: PanelTransferFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PanelTransferError';
    this.code = code;
  }
}

export interface PanelHostBroker {
  /** Optional asynchronous transport setup for native webview IPC. */
  ready?(): Promise<void>;
  reservePanelHost(request: {
    transactionId: string;
    windowId: string;
    panelTypeId: string;
    panelInstanceId: string;
    transferSnapshot?: PanelTransferSnapshot;
    timeoutMs?: number;
  }): Promise<unknown>;
  abortPanelHost(transactionId: string, reason?: string): boolean;
}

export interface DetachPanelRequest {
  panelTypeId: PanelTypeId;
  panelInstanceId: string;
  sourceWindowId: string;
  /** Current visible panel width, used only as a preferred initial width. */
  sourceWidth?: number;
  documentId?: string | null;
  activeDocumentId?: string | null;
  /** Restores focus to the invoking control on rollback. */
  focusSource?: () => void;
  /** Accessible status announcement owned by the caller's live region. */
  announce?: (message: string) => void;
  timeoutMs?: number;
  onDetached?: (windowId: string) => void;
}

export interface DetachPanelResult {
  windowId: string;
  transactionId?: string;
  status: 'detached' | 'already-detached';
}

export interface PanelTransferCoordinatorOptions {
  windowService: NativeWindowService;
  broker: PanelHostBroker;
  sessionId: string;
  stateMachine?: TransferStateMachine;
  createWindowId?: () => string;
  getPanelDefinition?: (panelTypeId: PanelTypeId) => PanelDefinition;
  getDetachedPanel?: (panelTypeId: PanelTypeId) => DetachedPanelRecord | undefined;
  markPanelDetached?: (
    panelTypeId: PanelTypeId,
    panelInstanceId: string,
    windowId: string,
    sessionId: string,
  ) => void;
  resolveInitialPlacement?: (
    panelTypeId: PanelTypeId,
    minimumSize: { width: number; height: number },
  ) => Promise<WindowPlacement | undefined>;
}

function routeForDetachedPanel(input: {
  windowId: string;
  sessionId: string;
  panelTypeId: PanelTypeId;
  transactionId: string;
  panelInstanceId: string;
}): string {
  const query = new URLSearchParams({
    surface: 'panel-window',
    windowId: input.windowId,
    session: input.sessionId,
    panels: input.panelTypeId,
    transaction: input.transactionId,
    panelInstanceId: input.panelInstanceId,
  });
  return `?${query.toString()}`;
}

function preferredWindowSize(
  definition: PanelDefinition,
  sourceWidth: number | undefined,
): { width: number; height: number } {
  const preferred = definition.preferredSize ?? definition.minimumSize;
  const requestedWidth = Number.isFinite(sourceWidth)
    ? Math.floor(sourceWidth ?? 0)
    : preferred.width;
  return {
    // A collapsed dock may be narrower than a standalone panel's usable
    // chrome. Prefer the definition's designed width, while retaining a
    // deliberately wider source panel when one is available.
    width: Math.max(definition.minimumSize.width, preferred.width, requestedWidth),
    height: Math.max(definition.minimumSize.height, preferred.height),
  };
}

function createTransferFailure(code: PanelTransferFailureCode, error: unknown): PanelTransferError {
  if (error instanceof PanelTransferError) return error;
  const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
  return new PanelTransferError(code, `Panel detachment could not be completed${detail}`, {
    cause: error,
  });
}

/**
 * Purely orchestrational object; React controls share one instance at runtime
 * but unit tests can inject a memory window service and controlled readiness.
 */
export class PanelTransferCoordinator {
  private readonly stateMachine: TransferStateMachine;
  private readonly createWindowId: () => string;
  private readonly getDefinition: (panelTypeId: PanelTypeId) => PanelDefinition;
  private readonly existingRecord: (panelTypeId: PanelTypeId) => DetachedPanelRecord | undefined;
  private readonly commitDetached: NonNullable<
    PanelTransferCoordinatorOptions['markPanelDetached']
  >;
  private readonly resolveInitialPlacement: NonNullable<
    PanelTransferCoordinatorOptions['resolveInitialPlacement']
  >;

  constructor(private readonly options: PanelTransferCoordinatorOptions) {
    this.stateMachine = options.stateMachine ?? new TransferStateMachine();
    this.createWindowId = options.createWindowId ?? createPanelWindowId;
    this.getDefinition = options.getPanelDefinition ?? getPanelDefinition;
    this.existingRecord = options.getDetachedPanel ?? getDetachedPanel;
    this.commitDetached = options.markPanelDetached ?? markPanelDetached;
    this.resolveInitialPlacement =
      options.resolveInitialPlacement ??
      ((panelTypeId, minimumSize) =>
        resolveSavedPanelWindowPlacement(panelTypeId, options.windowService, minimumSize));
  }

  async detach(request: DetachPanelRequest): Promise<DetachPanelResult> {
    const existing = this.existingRecord(request.panelTypeId);
    if (existing) {
      recordPanelWindowDiagnostic({
        type: 'detach-requested',
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        sourceWindowId: request.sourceWindowId,
        destinationWindowId: existing.windowId,
        sessionId: this.options.sessionId,
        result: 'already-detached',
      });
      recordPanelWindowDiagnostic({
        type: 'focus-requested',
        panelTypeId: request.panelTypeId,
        windowId: existing.windowId,
        sessionId: this.options.sessionId,
      });
      await this.options.windowService.focusWindow(existing.windowId).catch(() => {});
      request.announce?.(
        `${this.getDefinition(request.panelTypeId).title} panel is already detached.`,
      );
      return { windowId: existing.windowId, status: 'already-detached' };
    }

    if (this.options.windowService.capability === 'single-window') {
      throw new PanelTransferError(
        'unsupported',
        'Panel detachment is available in the desktop app when an auxiliary window can be opened.',
      );
    }

    const definition = this.getDefinition(request.panelTypeId);
    if (
      !definition.detachable ||
      !definition.allowedHosts.includes('auxiliary-window') ||
      !definition.lifecycle?.prepareForTransfer ||
      !definition.localStateCodec
    ) {
      throw new PanelTransferError('not-detachable', `${definition.title} cannot be detached.`);
    }

    try {
      // Tauri event listeners are registered asynchronously. Arm the primary
      // before the child can send its queued `window-ready` registration.
      await this.options.broker.ready?.();
    } catch (error) {
      const failure = createTransferFailure('host-unavailable', error);
      request.focusSource?.();
      request.announce?.(`Panel detachment failed; the ${definition.title} panel remains docked.`);
      throw failure;
    }

    const targetWindowId = this.createWindowId();
    let transaction: ReturnType<TransferStateMachine['start']>;
    try {
      transaction = this.stateMachine.start({
        direction: 'detach',
        panelInstanceId: request.panelInstanceId,
        panelTypeId: request.panelTypeId,
        sourceWindowId: request.sourceWindowId,
        sourceNodeId: `panel-${request.panelInstanceId}`,
        targetWindowId,
      });
    } catch (error) {
      const failure = createTransferFailure('invalid-transfer-state', error);
      request.focusSource?.();
      request.announce?.(`Panel detachment failed; the ${definition.title} panel remains docked.`);
      throw failure;
    }
    recordPanelWindowDiagnostic({
      type: 'detach-requested',
      transactionId: transaction.id,
      panelTypeId: request.panelTypeId,
      panelInstanceId: request.panelInstanceId,
      sourceWindowId: request.sourceWindowId,
      destinationWindowId: targetWindowId,
      sessionId: this.options.sessionId,
      lifecyclePhase: transaction.state,
    });
    let readiness: Promise<unknown> | null = null;
    let readinessFailure: unknown = null;
    let createdWindowId: string | null = null;

    try {
      const prepared = await definition.lifecycle.prepareForTransfer({
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        originHostId: request.sourceWindowId,
        destinationHostId: targetWindowId,
        documentId: request.documentId ?? null,
        activeDocumentId: request.activeDocumentId ?? null,
      });
      const snapshot = definition.localStateCodec.encode(prepared);
      if (
        !snapshot ||
        snapshot.panelTypeId !== request.panelTypeId ||
        snapshot.byteSize > definition.localStateCodec.maxBytes
      ) {
        throw new PanelTransferError(
          'invalid-transfer-state',
          `${definition.title} has state that cannot be transferred safely.`,
        );
      }
      this.stateMachine.setSnapshot(transaction.id, snapshot);
      this.stateMachine.advance(transaction.id, 'creating-destination');

      // Reserve first: every reply must prove this exact canonical identity.
      recordPanelWindowDiagnostic({
        type: 'destination-host-reserved',
        transactionId: transaction.id,
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        sourceWindowId: request.sourceWindowId,
        destinationWindowId: targetWindowId,
        sessionId: this.options.sessionId,
        lifecyclePhase: 'creating-destination',
      });
      readiness = this.options.broker.reservePanelHost({
        transactionId: transaction.id,
        windowId: targetWindowId,
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        transferSnapshot: snapshot,
        timeoutMs: request.timeoutMs,
      });
      // A reservation can reject synchronously when the primary is closing.
      // Attach a handler before any more awaits so that rejection is never
      // reported as unhandled while placement/window creation is in flight.
      void readiness.catch((error) => {
        readinessFailure = error;
      });
      // Give an immediate rejection a chance to settle before allocating a
      // destination. A normal pending reservation remains pending here.
      await Promise.resolve();
      if (readinessFailure) throw readinessFailure;

      const placement = await this.resolveInitialPlacement(
        request.panelTypeId,
        definition.minimumSize,
      );
      if (readinessFailure) throw readinessFailure;
      recordPanelWindowDiagnostic({
        type: 'destination-window-create-started',
        transactionId: transaction.id,
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        sourceWindowId: request.sourceWindowId,
        destinationWindowId: targetWindowId,
        sessionId: this.options.sessionId,
        lifecyclePhase: 'creating-destination',
        ...(placement
          ? {
              displayId: placement.displayId,
              logicalBounds: {
                x: placement.logicalPosition.x,
                y: placement.logicalPosition.y,
                width: placement.logicalSize.width,
                height: placement.logicalSize.height,
              },
            }
          : {}),
      });
      const created = await this.options.windowService.createWindow({
        id: targetWindowId,
        title: `${definition.title} — Varve`,
        size: preferredWindowSize(definition, request.sourceWidth),
        minSize: definition.minimumSize,
        placement,
        route: routeForDetachedPanel({
          windowId: targetWindowId,
          sessionId: this.options.sessionId,
          panelTypeId: request.panelTypeId,
          transactionId: transaction.id,
          panelInstanceId: request.panelInstanceId,
        }),
      });
      createdWindowId = created.id;
      if (readinessFailure) throw readinessFailure;
      recordPanelWindowDiagnostic({
        type: 'destination-window-created',
        transactionId: transaction.id,
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        sourceWindowId: request.sourceWindowId,
        destinationWindowId: created.id,
        sessionId: this.options.sessionId,
      });
      if (created.id !== targetWindowId) {
        throw new PanelTransferError(
          'destination-failed',
          'The window platform returned an unexpected panel identity.',
        );
      }

      this.stateMachine.advance(transaction.id, 'waiting-ready');
      this.stateMachine.advance(transaction.id, 'hydrating');
      await readiness;
      this.stateMachine.advance(transaction.id, 'acknowledged');
      recordPanelWindowDiagnostic({
        type: 'panel-hydrated',
        transactionId: transaction.id,
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        sourceWindowId: request.sourceWindowId,
        destinationWindowId: targetWindowId,
        sessionId: this.options.sessionId,
        lifecyclePhase: 'acknowledged',
      });

      // Native windows are intentionally created hidden. Browser popups are
      // already visible but the service keeps the same call as a no-op.
      await this.options.windowService.showWindow(targetWindowId);
      this.stateMachine.advance(transaction.id, 'committing');
      this.commitDetached(
        request.panelTypeId,
        request.panelInstanceId,
        targetWindowId,
        this.options.sessionId,
      );
      this.stateMachine.advance(transaction.id, 'removing-source');
      recordPanelWindowDiagnostic({
        type: 'source-removal-committed',
        transactionId: transaction.id,
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        sourceWindowId: request.sourceWindowId,
        destinationWindowId: targetWindowId,
        sessionId: this.options.sessionId,
        lifecyclePhase: 'removing-source',
      });
      this.stateMachine.complete(transaction.id);

      recordPanelWindowDiagnostic({
        type: 'focus-requested',
        transactionId: transaction.id,
        panelTypeId: request.panelTypeId,
        windowId: targetWindowId,
        sessionId: this.options.sessionId,
      });
      await this.options.windowService.focusWindow(targetWindowId).then(
        () =>
          recordPanelWindowDiagnostic({
            type: 'focus-confirmed',
            transactionId: transaction.id,
            panelTypeId: request.panelTypeId,
            windowId: targetWindowId,
            sessionId: this.options.sessionId,
          }),
        () => {},
      );
      request.announce?.(`${definition.title} panel detached into a new window.`);
      request.onDetached?.(targetWindowId);
      return { windowId: targetWindowId, transactionId: transaction.id, status: 'detached' };
    } catch (error) {
      const failure = createTransferFailure(
        error instanceof PanelTransferError ? error.code : 'destination-failed',
        error,
      );
      recordPanelWindowDiagnostic({
        type: 'detach-rollback-started',
        transactionId: transaction.id,
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        sourceWindowId: request.sourceWindowId,
        destinationWindowId: targetWindowId,
        sessionId: this.options.sessionId,
        errorCode: failure.code,
      });
      if (readiness) {
        this.options.broker.abortPanelHost(transaction.id, failure.message);
        // A reserve promise may reject after native creation fails. Consuming
        // it here prevents an unhandled rejection while the rollback closes.
        void readiness.catch(() => {});
      }
      if (createdWindowId) {
        await this.options.windowService.closeWindow(createdWindowId).catch(() => {});
      }
      const active = this.stateMachine.get(transaction.id);
      if (active && active.state !== 'failed' && active.state !== 'idle') {
        this.stateMachine.fail(transaction.id, failure.message);
        this.stateMachine.advance(transaction.id, 'idle');
      }
      request.focusSource?.();
      recordPanelWindowDiagnostic({
        type: 'detach-rollback-completed',
        transactionId: transaction.id,
        panelTypeId: request.panelTypeId,
        panelInstanceId: request.panelInstanceId,
        sourceWindowId: request.sourceWindowId,
        destinationWindowId: targetWindowId,
        sessionId: this.options.sessionId,
        errorCode: failure.code,
      });
      request.announce?.(`Panel detachment failed; the ${definition.title} panel remains docked.`);
      throw failure;
    }
  }
}

/** Resolve a prior per-panel placement onto the current monitor topology. */
export async function resolveSavedPanelWindowPlacement(
  panelTypeId: PanelTypeId,
  windowService: NativeWindowService,
  minimumSize: { width: number; height: number },
): Promise<WindowPlacement | undefined> {
  const saved = loadPanelPlacement(panelTypeId);
  if (!saved) return undefined;
  const displays = await windowService.listMonitors().catch(() => []);
  const restored = restorePanelPlacement(saved, displays, { minSize: minimumSize });
  if (!restored) return undefined;
  // A fresh detach should always become reachable/visible, even if the old
  // host was minimized when the user closed it.
  return restored.placement.state === 'minimized'
    ? { ...restored.placement, state: 'normal' }
    : restored.placement;
}

const sharedStateMachine = new TransferStateMachine();

/** Runtime entry point used by button and drag controls in the primary editor. */
export async function detachPanel(request: DetachPanelRequest): Promise<DetachPanelResult> {
  const sessionId = getPanelWindowSessionId();
  const broker = getSessionBroker(sessionId);
  if (!broker) {
    throw new PanelTransferError(
      'host-unavailable',
      'The editor session is not ready to open a panel window yet.',
    );
  }
  const coordinator = new PanelTransferCoordinator({
    windowService: getWindowService(),
    broker,
    sessionId,
    stateMachine: sharedStateMachine,
  });
  return coordinator.detach(request);
}
