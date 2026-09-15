/**
 * Watcher event model (ADR-0111).
 *
 * A pure reducer over filesystem event streams: debounce and coalesce
 * bursts (editor save = temp file + rename), ignore self-writes, reject
 * stale results, pause during conflict-resolution writes, and recover when
 * the source returns. The platform port feeds events in; this module
 * decides what the sync layer sees.
 */
import type { TokenDiagnostic } from './types';

export type WatcherEventKind =
  | 'created'
  | 'modified'
  | 'removed'
  | 'renamed'
  | 'permission-lost'
  | 'resumed';

export interface WatcherEvent {
  seq: number;
  kind: WatcherEventKind;
  path: string;
  at: number;
  /** Set for events caused by Varve's own writes (self-write suppression). */
  selfWrite?: boolean;
}

export interface WatcherState {
  /** Monotonic sequence of the last accepted event. */
  lastSeq: number;
  /** Pending coalesced changes per path. */
  pending: Map<string, { kind: WatcherEventKind; at: number }>;
  /** Debounce window in ms. */
  debounceMs: number;
  paused: boolean;
  pausedReason?: string;
  /** Last content hash observed per path (formatting-only suppression). */
  lastHashes: Map<string, string>;
  /** Events coalesced so far. */
  coalescedCount: number;
  diagnostics: TokenDiagnostic[];
}

export interface WatcherFlush {
  events: WatcherEvent[];
  hasChanges: boolean;
}

export function createWatcherState(debounceMs = 250): WatcherState {
  return {
    lastSeq: 0,
    pending: new Map(),
    debounceMs,
    paused: false,
    lastHashes: new Map(),
    coalescedCount: 0,
    diagnostics: [],
  };
}

export function pauseWatcher(state: WatcherState, reason: string): WatcherState {
  return { ...state, paused: true, pausedReason: reason };
}

export function resumeWatcher(state: WatcherState): WatcherState {
  return { ...state, paused: false, pausedReason: undefined, pending: new Map() };
}

/**
 * Reduce a raw event into the watcher state. Returns the pending events
 * that are due (debounce elapsed) — typically one logical event per path.
 */
export function reduceWatcherEvent(
  state: WatcherState,
  event: Omit<WatcherEvent, 'seq'>,
  now: number,
): { state: WatcherState; due: WatcherEvent[] } {
  if (state.paused) {
    return { state, due: [] };
  }
  if (event.selfWrite) {
    return { state, due: [] };
  }
  const seq = state.lastSeq + 1;
  const pending = new Map(state.pending);
  const existing = pending.get(event.path);
  pending.set(event.path, {
    kind: event.kind,
    at: existing ? Math.min(existing.at, event.at) : event.at,
  });
  const next: WatcherState = {
    ...state,
    lastSeq: seq,
    pending,
    coalescedCount: state.coalescedCount + 1,
  };
  const due: WatcherEvent[] = [];
  if (pending.size > 0 && now - [...pending.values()][0]!.at >= state.debounceMs) {
    for (const [path, change] of pending) {
      due.push({ seq, kind: change.kind, path, at: change.at });
    }
    next.pending = new Map();
  }
  return { state: next, due };
}

/**
 * Flush all pending events immediately (used before shutdown or before a
 * conflict-resolution write).
 */
export function flushWatcher(state: WatcherState): { state: WatcherState; flush: WatcherFlush } {
  const events: WatcherEvent[] = [];
  for (const [path, change] of state.pending) {
    events.push({ seq: ++state.lastSeq, kind: change.kind, path, at: change.at });
  }
  return {
    state: { ...state, pending: new Map() },
    flush: { events, hasChanges: events.length > 0 },
  };
}

/** Compare a fresh content hash against the last observed one. */
export function shouldProcessContent(
  state: WatcherState,
  path: string,
  contentHash: string,
): { state: WatcherState; changed: boolean } {
  const last = state.lastHashes.get(path);
  if (last === contentHash) {
    return { state, changed: false };
  }
  return {
    state: { ...state, lastHashes: new Map(state.lastHashes).set(path, contentHash) },
    changed: true,
  };
}
