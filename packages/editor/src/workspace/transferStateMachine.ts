/**
 * Panel transfer state machine (ADR-0208).
 *
 * Manages atomic detach/reattach transactions. Each transfer follows
 * a strict state machine with rollback on failure.
 *
 * States:
 *   IDLE → PREPARING_SOURCE → CREATING_DESTINATION → WAITING_READY
 *   → HYDRATING → ACKNOWLEDGED → COMMITTING → REMOVING_SOURCE → COMPLETE
 *
 * Any failure → rolls back to IDLE.
 */

// ---------------------------------------------------------------------------
// Transfer state
// ---------------------------------------------------------------------------

export type TransferState =
  | 'idle'
  | 'preparing-source'
  | 'creating-destination'
  | 'waiting-ready'
  | 'hydrating'
  | 'acknowledged'
  | 'committing'
  | 'removing-source'
  | 'complete'
  | 'failed';

export type TransferDirection = 'detach' | 'reattach';

export interface PanelTransferTransaction {
  id: string;
  direction: TransferDirection;
  state: TransferState;
  panelInstanceId: string;
  panelTypeId: string;
  sourceWindowId: string;
  sourceNodeId: string;
  targetWindowId: string;
  targetNodeId?: string;
  snapshot?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<TransferState, TransferState[]> = {
  idle: ['preparing-source'],
  'preparing-source': ['creating-destination', 'failed'],
  'creating-destination': ['waiting-ready', 'failed'],
  'waiting-ready': ['hydrating', 'failed'],
  hydrating: ['acknowledged', 'failed'],
  acknowledged: ['committing', 'failed'],
  committing: ['removing-source', 'failed'],
  'removing-source': ['complete', 'failed'],
  complete: ['idle'],
  failed: ['idle'],
};

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export class TransferStateMachine {
  private transactions = new Map<string, PanelTransferTransaction>();

  /** Start a new transfer. Returns the transaction. */
  start(options: {
    direction: TransferDirection;
    panelInstanceId: string;
    panelTypeId: string;
    sourceWindowId: string;
    sourceNodeId: string;
    targetWindowId: string;
    targetNodeId?: string;
  }): PanelTransferTransaction {
    // Check if this panel already has an active transfer
    for (const tx of this.transactions.values()) {
      if (
        tx.panelInstanceId === options.panelInstanceId &&
        tx.state !== 'complete' &&
        tx.state !== 'failed' &&
        tx.state !== 'idle'
      ) {
        throw new Error(
          `panel '${options.panelInstanceId}' already has an active transfer '${tx.id}'`,
        );
      }
    }

    const id = `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const tx: PanelTransferTransaction = {
      id,
      direction: options.direction,
      state: 'preparing-source',
      panelInstanceId: options.panelInstanceId,
      panelTypeId: options.panelTypeId,
      sourceWindowId: options.sourceWindowId,
      sourceNodeId: options.sourceNodeId,
      targetWindowId: options.targetWindowId,
      targetNodeId: options.targetNodeId,
      createdAt: now,
      updatedAt: now,
    };
    this.transactions.set(id, tx);
    return tx;
  }

  /** Advance a transaction to the next state. Throws on invalid transition. */
  advance(transactionId: string, nextState: TransferState): PanelTransferTransaction {
    const tx = this.transactions.get(transactionId);
    if (!tx) throw new Error(`unknown transaction '${transactionId}'`);

    const valid = VALID_TRANSITIONS[tx.state];
    if (!valid?.includes(nextState)) {
      throw new Error(
        `invalid transition: ${tx.state} → ${nextState} (valid: ${valid?.join(', ') ?? 'none'})`,
      );
    }

    const updated: PanelTransferTransaction = {
      ...tx,
      state: nextState,
      updatedAt: Date.now(),
    };
    this.transactions.set(transactionId, updated);
    return updated;
  }

  /** Set the snapshot on a transaction (during waiting-ready → hydrating). */
  setSnapshot(transactionId: string, snapshot: unknown): PanelTransferTransaction {
    const tx = this.transactions.get(transactionId);
    if (!tx) throw new Error(`unknown transaction '${transactionId}'`);
    const updated = { ...tx, snapshot, updatedAt: Date.now() };
    this.transactions.set(transactionId, updated);
    return updated;
  }

  /** Fail a transaction from any non-terminal state. */
  fail(transactionId: string, reason: string): PanelTransferTransaction {
    const tx = this.transactions.get(transactionId);
    if (!tx) throw new Error(`unknown transaction '${transactionId}'`);
    if (tx.state === 'complete' || tx.state === 'idle') {
      throw new Error(`cannot fail transaction in state '${tx.state}'`);
    }
    const updated: PanelTransferTransaction = {
      ...tx,
      state: 'failed',
      error: reason,
      updatedAt: Date.now(),
    };
    this.transactions.set(transactionId, updated);
    return updated;
  }

  /** Get a transaction by id. */
  get(transactionId: string): PanelTransferTransaction | undefined {
    return this.transactions.get(transactionId);
  }

  /** Get the active transfer for a panel instance. */
  getActiveForPanel(panelInstanceId: string): PanelTransferTransaction | undefined {
    for (const tx of this.transactions.values()) {
      if (
        tx.panelInstanceId === panelInstanceId &&
        tx.state !== 'complete' &&
        tx.state !== 'failed' &&
        tx.state !== 'idle'
      ) {
        return tx;
      }
    }
    return undefined;
  }

  /** Check if a panel has an active transfer. */
  isTransferring(panelInstanceId: string): boolean {
    return this.getActiveForPanel(panelInstanceId) !== undefined;
  }

  /** Complete a transaction and reset to idle. */
  complete(transactionId: string): PanelTransferTransaction {
    this.advance(transactionId, 'complete');
    // Auto-advance to idle after complete
    return this.advance(transactionId, 'idle');
  }

  /** List all transactions (tests/debug). */
  list(): PanelTransferTransaction[] {
    return [...this.transactions.values()];
  }

  /** Clear all transactions (tests only). */
  clear(): void {
    this.transactions.clear();
  }
}

// ---------------------------------------------------------------------------
// Transfer helpers
// ---------------------------------------------------------------------------

/** Generate a transaction id. */
export function generateTransactionId(): string {
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate that a transfer is allowed given the current state.
 * Returns an error message or null if allowed.
 */
export function validateTransfer(
  panelInstanceId: string,
  direction: 'detach' | 'reattach',
  activeTransfers: Map<string, PanelTransferTransaction>,
  panelCapabilities: {
    detachable: boolean;
    allowedHosts: readonly string[];
  },
  targetHostKind: string,
): string | null {
  if (direction === 'detach' && !panelCapabilities.detachable) {
    return 'panel is not detachable';
  }
  if (!panelCapabilities.allowedHosts.includes(targetHostKind)) {
    return `panel cannot host in '${targetHostKind}'`;
  }
  for (const tx of activeTransfers.values()) {
    if (
      tx.panelInstanceId === panelInstanceId &&
      tx.state !== 'complete' &&
      tx.state !== 'failed'
    ) {
      return `panel already has an active transfer (${tx.id})`;
    }
  }
  return null;
}
