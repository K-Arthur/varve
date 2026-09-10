/**
 * Inference diagnostics — tracks AI model performance for the diagnostics UI.
 *
 * Collects non-private telemetry about inference: model used, precision,
 * latency, execution provider, memory. Never collects document contents,
 * input images, or other private data.
 */

import type { InferenceQualityPreference } from '../types';

export interface InferenceDiagnosticEvent {
  /** Monotonic sequence ID. */
  seq: number;
  /** Timestamp (ms since epoch). */
  timestamp: number;
  /** Model ID used (e.g. 'u2netp', 'u2netp-int8'). */
  modelId: string;
  /** Model precision. */
  modelPrecision: 'fp32' | 'int8';
  /** Execution provider used. */
  executionProvider: 'webgpu' | 'webgl' | 'wasm' | 'native';
  /** Total processing time in ms. */
  processingTimeMs: number;
  /** Input dimensions (width x height). */
  inputWidth: number;
  inputHeight: number;
  /** Quality preference that led to this selection. */
  qualityPreference: InferenceQualityPreference;
  /** True when precision fell back from INT8 to FP32. */
  precisionFallback: boolean;
  /** Reason for precision fallback, if any. */
  precisionFallbackReason?: string;
}

export interface InferenceDiagnosticsState {
  events: InferenceDiagnosticEvent[];
  coldStartMs: number | null;
  totalInferences: number;
}

const MAX_EVENTS = 50;

let state: InferenceDiagnosticsState = {
  events: [],
  coldStartMs: null,
  totalInferences: 0,
};

let seqCounter = 0;

/**
 * Record an inference event. Trims the buffer when it exceeds MAX_EVENTS.
 */
export function recordInferenceEvent(
  event: Omit<InferenceDiagnosticEvent, 'seq' | 'timestamp'>,
): InferenceDiagnosticEvent {
  const fullEvent: InferenceDiagnosticEvent = {
    ...event,
    seq: ++seqCounter,
    timestamp: Date.now(),
  };
  state = {
    ...state,
    events: [...state.events.slice(-(MAX_EVENTS - 1)), fullEvent],
    totalInferences: state.totalInferences + 1,
  };
  return fullEvent;
}

/** Record the cold-start time (first model load). */
export function recordColdStart(durationMs: number): void {
  if (state.coldStartMs === null) {
    state = { ...state, coldStartMs: durationMs };
  }
}

/** Get the current diagnostics state (for UI rendering). */
export function getInferenceDiagnostics(): InferenceDiagnosticsState {
  return state;
}

/** Subscribe to diagnostics updates. Returns an unsubscribe function. */
export type DiagnosticsListener = (state: InferenceDiagnosticsState) => void;

let listeners: DiagnosticsListener[] = [];

export function subscribeInferenceDiagnostics(fn: DiagnosticsListener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

function notifyListeners(): void {
  for (const fn of listeners) {
    fn(state);
  }
}

/** Reset diagnostics (for testing). */
export function resetInferenceDiagnostics(): void {
  state = {
    events: [],
    coldStartMs: null,
    totalInferences: 0,
  };
  seqCounter = 0;
  notifyListeners();
}
