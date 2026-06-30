/**
 * @strata/collab — local-first CRDT awareness + reconnect (Strata plan §3.2, Phase 2).
 *
 * P5: Transaction hooks for Yjs integration. These are stub hook points
 * that will be wired to Yjs document transactions when sync lands in
 * Phase 2. The editor's beginTransaction/commitTransaction/abortTransaction
 * will call these hooks to batch Yjs updates into a single undo entry.
 */

/** Marker for the collab package. */
export const PACKAGE = '@strata/collab' as const;

/**
 * Transaction hook interface. The editor calls these when a transaction
 * is in progress. When Yjs is wired in, these will wrap Y.Doc.transact().
 */
export interface TransactionHooks {
  /** Called when a document transaction begins. */
  onBeginTransaction: () => void;
  /** Called when a document transaction commits (success). */
  onCommitTransaction: () => void;
  /** Called when a document transaction is aborted (rollback). */
  onAbortTransaction: () => void;
}

/** No-op transaction hooks (default when sync is not active). */
export const noopTransactionHooks: TransactionHooks = {
  onBeginTransaction: () => {},
  onCommitTransaction: () => {},
  onAbortTransaction: () => {},
};

/**
 * Register transaction hooks. Returns an unregister function.
 * When Yjs is wired in, this will connect to the Y.Doc instance.
 */
export function registerTransactionHooks(hooks: TransactionHooks): () => void {
  // Phase 2: store hooks for the active Y.Doc connection
  // For now, this is a no-op stub
  _activeHooks = hooks;
  return () => {
    if (_activeHooks === hooks) {
      _activeHooks = noopTransactionHooks;
    }
  };
}

/** Get the currently active transaction hooks. */
export function getTransactionHooks(): TransactionHooks {
  return _activeHooks;
}

let _activeHooks: TransactionHooks = noopTransactionHooks;
