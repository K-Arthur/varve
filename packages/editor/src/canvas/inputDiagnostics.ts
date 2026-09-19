/**
 * Input diagnostics — bounded trace of normalized input events for
 * cross-platform gesture debugging.
 *
 * Mirrors `drawDiagnostics`'s opt-in pattern: off by default everywhere,
 * callers enable explicitly. Exposes a small ring buffer of normalized
 * records so a developer can inspect how wheel/pinch/pointer/keyboard events
 * were classified and what viewport mutation each produced — without flooding
 * the console or paying anything in production.
 */

export type DiagnosticInputSource =
  | 'mouse'
  | 'pen'
  | 'touch'
  | 'keyboard'
  | 'wheel'
  | 'trackpad'
  | 'unknown';

export interface InputDiagnosticRecord {
  /** Monotonic event sequence number. */
  seq: number;
  /** Wall-clock timestamp (performance.now). */
  timestamp: number;
  /** Raw event type, e.g. 'pointerdown' | 'wheel' | 'keydown'. */
  eventType: string;
  /** Normalized input source. */
  source: DiagnosticInputSource;
  /** Pointer type when a pointer event. */
  pointerType?: string;
  /** Pointer identifier when a pointer event. */
  pointerId?: number;
  /** Button mask (e.buttons) when a pointer event. */
  buttons?: number;
  /** Modifier snapshot. */
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
  };
  /** Normalized wheel deltas (CSS px) and deltaMode, when a wheel event. */
  wheel?: {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    /** trackpad | mouse | unknown */
    source: string;
    kind: 'zoom' | 'pan';
    scale: number;
  };
  /** Viewport after the mutation this event caused.
   *  Note: the wheel handler captures `stateRef.current` before applying the
   *  action, so this is the viewport BEFORE the event's mutation — the last
   *  record always lags the live camera by one event. Snapshot the current
   *  camera by dispatching a zero-delta wheel (records without mutating). */
  viewport?: {
    zoom: number;
    panX: number;
    panY: number;
    rotation: number;
  };
  /** Milliseconds this handler took to process the event. */
  processingMs?: number;
  /** Whether the handler called preventDefault. */
  preventedDefault?: boolean;
}

const MAX_DIAG_RECORDS = 200;
const ring: InputDiagnosticRecord[] = [];
let diagEnabled = false;
let seq = 0;

export function enableInputDiagnostics(force?: boolean): void {
  diagEnabled = force === true;
}

export function isInputDiagnosticsEnabled(): boolean {
  return diagEnabled;
}

export function resetInputDiagnostics(): void {
  ring.length = 0;
  seq = 0;
}

export function getInputDiagnosticCount(): number {
  return ring.length;
}

export function getRecentInputDiagnostics(n = 10): InputDiagnosticRecord[] {
  return ring.slice(-n);
}

/** Record a normalized input event. No-op unless diagnostics are enabled. */
export function recordInputDiagnostic(
  partial: Omit<InputDiagnosticRecord, 'seq' | 'timestamp'>,
): InputDiagnosticRecord | null {
  if (!diagEnabled) return null;
  const record: InputDiagnosticRecord = {
    ...partial,
    seq: seq++,
    timestamp: performance.now(),
  };
  ring.push(record);
  if (ring.length > MAX_DIAG_RECORDS) ring.shift();
  return record;
}

/**
 * Install the input-diagnostics debug handle as `window.__varveInputDiagnostics`.
 *
 * Installing the handle is free — the ring records nothing until
 * `enable()` is called — so unlike `__varvePerf` this installs
 * unconditionally: the gesture-debug workflow it exists for (capture a real
 * trackpad pinch/wheel session on a device that may not expose a query
 * parameter, e.g. the Tauri desktop shell) needs a console one-liner:
 *
 * ```js
 * __varveInputDiagnostics.enable();   // …perform the gestures…
 * copy(__varveInputDiagnostics.export())  // raw + normalized records
 * ```
 */
export function installInputDiagnosticsHandle(): void {
  if (typeof window === 'undefined') return;
  const globalThisAny = window as unknown as {
    __varveInputDiagnostics?: {
      enable: (on?: boolean) => void;
      isEnabled: () => boolean;
      records: (n?: number) => InputDiagnosticRecord[];
      export: () => string;
      clear: () => void;
    };
  };
  if (globalThisAny.__varveInputDiagnostics) return;
  globalThisAny.__varveInputDiagnostics = {
    enable: (on = true) => enableInputDiagnostics(on),
    isEnabled: isInputDiagnosticsEnabled,
    records: (n = 200) => getRecentInputDiagnostics(n),
    export: () =>
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
          records: getRecentInputDiagnostics(200),
        },
        null,
        2,
      ),
    clear: resetInputDiagnostics,
  };
}
