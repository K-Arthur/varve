/**
 * Design-token synchronization core (ADR-0100..ADR-0121).
 *
 * Canonical token store, stable identity, provenance, sources, sync state,
 * tombstones, and base snapshots. DTCG parsing/validation/diff/merge live in
 * @varve/tokens; this module owns the document-persistent model and the
 * bridge to the existing VariableStore.
 */

export * from './identity';
export * from './model';
export * from './store';
export * from './variableBridge';
