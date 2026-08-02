/**
 * @strata/platform — canonical runtime capabilities abstraction.
 *
 * One authoritative place for runtime detection. Every other module must
 * import from here instead of reimplementing `'__TAURI__' in window`.
 *
 * Design:
 *  - `RuntimeKind` — coarse backend kind (memory / web / tauri).
 *  - `PlatformInfo` — structured OS + runtime + capabilities snapshot.
 *  - `detectRuntimeKind()` — single source of truth for the detection check.
 *  - `getPlatformInfo()` — memoised full info snapshot.
 *  - `setPlatformInfoForTest()` — deterministic injection for tests.
 *
 * SSR-safe: returns `'memory'` when `window` is undefined.
 * Worker-safe: returns `'web'` in Web Workers (no DOM, no Tauri global).
 */

// ─── Runtime kind ──────────────────────────────────────────────────────────
export type RuntimeKind = 'memory' | 'web' | 'tauri';

// ─── Operating system ──────────────────────────────────────────────────────
export type OsKind = 'mac' | 'windows' | 'linux' | 'unknown';

// ─── Capability flags ──────────────────────────────────────────────────────
/**
 * Canonical capability identifiers used for UI gating, menu item visibility,
 * toolbar filtering, and feature detection.
 *
 * Every capability here MUST have a corresponding detection check in
 * `computeCapabilities()`. Add new capabilities as the application grows;
 * never add another `isTauriRuntime()` helper.
 */
export type PlatformCapability =
  | 'fs.read'
  | 'fs.write'
  | 'fs.watch'
  | 'fs.recentPaths'
  | 'archive'
  | 'backup'
  | 'nativeMenu'
  | 'multiWindow'
  | 'shell.open'
  | 'fonts.local'
  | 'clipboard.image'
  | 'notifications'
  | 'autoUpdate'
  | 'offscreenCanvas'
  | 'webgpu'
  | 'webgl'
  | 'webWorker'
  | 'sharedArrayBuffer'
  | 'wasm'
  | 'wasmSimd'
  | 'onnxWasm'
  | 'indexedDb';

// ─── Platform info snapshot ────────────────────────────────────────────────
export interface PlatformInfo {
  /** Runtime backend kind. */
  readonly kind: RuntimeKind;
  /** Operating system (best-effort). */
  readonly os: OsKind;
  /** Derived capability set. */
  readonly capabilities: ReadonlySet<PlatformCapability>;
  /** Whether Tauri IPC (`window.__TAURI__`) is present. */
  readonly hasTauriIpc: boolean;
  /** Whether the native filesystem is accessible. */
  readonly hasNativeFs: boolean;
  /** Whether Web GPU is available. */
  readonly hasWebGpu: boolean;
  /** Whether Web Workers are supported. */
  readonly hasWebWorker: boolean;
  /** Whether WebAssembly is available. */
  readonly hasWasm: boolean;
}

// ─── Override support for tests ────────────────────────────────────────────
let _override: PlatformInfo | null = null;

export function setPlatformInfoForTest(info: PlatformInfo | null): void {
  _override = info;
  _cached = null;
}

export function resetPlatformInfo(): void {
  _override = null;
  _cached = null;
}

// ─── Detection helpers ─────────────────────────────────────────────────────

/** Low-level check for the Tauri global. */
function hasTauriGlobal(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI__' in window;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

function hasWebGpu(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as { gpu?: unknown };
  return nav.gpu !== undefined && nav.gpu !== null;
}

function hasWebGl(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl') || !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function hasWebWorkerSupport(): boolean {
  return typeof Worker !== 'undefined';
}

function hasSharedArrayBuffer(): boolean {
  return typeof SharedArrayBuffer !== 'undefined';
}

function hasWasm(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof WebAssembly.compile === 'function';
}

function hasWasmSimd(): boolean {
  if (!hasWasm()) return false;
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 15, 11,
      ]),
    );
  } catch {
    return false;
  }
}

function hasFileSystemAccessAPI(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    showOpenFilePicker?: () => Promise<unknown>;
    showSaveFilePicker?: () => Promise<unknown>;
  };
  return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function';
}

function hasQueryLocalFonts(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as { queryLocalFonts?: () => Promise<unknown> };
  return 'queryLocalFonts' in w;
}

function canReadClipboardImages(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as { clipboard?: { read?: () => Promise<unknown> } };
  return typeof nav.clipboard?.read === 'function';
}

function hasNotifications(): boolean {
  return typeof Notification !== 'undefined';
}

function detectOs(): OsKind {
  if (typeof navigator === 'undefined') return 'unknown';
  const nav = navigator as { userAgent?: string; platform?: string };
  const ua = nav.userAgent ?? nav.platform ?? '';
  if (/mac/i.test(ua)) return 'mac';
  if (/win/i.test(ua)) return 'windows';
  if (/linux/i.test(ua)) return 'linux';
  return 'unknown';
}

// ─── Canonical detection ───────────────────────────────────────────────────

/**
 * Detect the runtime kind.
 *
 * Returns 'memory' when:
 *  - window is undefined (SSR, Node.js, tests without jsdom)
 *  - Neither Tauri nor IndexedDB is available
 *
 * Returns 'tauri' when the Tauri global is present.
 * Returns 'web' in browser environments (including Web Workers).
 */
export function detectRuntimeKind(): RuntimeKind {
  if (_override) return _override.kind;
  if (typeof window === 'undefined') return 'memory';
  if (hasTauriGlobal()) return 'tauri';
  if (hasIndexedDb() || typeof document !== 'undefined') return 'web';
  return 'memory';
}

/** Compute the full capability set from feature detection. */
function computeCapabilities(): Set<PlatformCapability> {
  const caps = new Set<PlatformCapability>();
  const kind = detectRuntimeKind();
  const isTauri = kind === 'tauri';

  // File system
  caps.add('fs.read');
  caps.add('fs.write');
  caps.add('shell.open');
  caps.add('backup');

  if (isTauri) {
    caps.add('fs.watch');
    caps.add('fs.recentPaths');
    caps.add('archive');
    caps.add('nativeMenu');
    caps.add('multiWindow');
    caps.add('autoUpdate');
  }

  if (hasQueryLocalFonts()) caps.add('fonts.local');
  if (canReadClipboardImages()) caps.add('clipboard.image');
  if (hasNotifications()) caps.add('notifications');
  if (hasFileSystemAccessAPI()) caps.add('fs.watch');

  if (hasOffscreenCanvas()) caps.add('offscreenCanvas');
  if (hasWebGpu()) caps.add('webgpu');
  if (hasWebGl()) caps.add('webgl');
  if (hasWebWorkerSupport()) caps.add('webWorker');
  if (hasSharedArrayBuffer()) caps.add('sharedArrayBuffer');
  if (hasWasm()) caps.add('wasm');
  if (hasWasmSimd()) caps.add('wasmSimd');

  // ONNX runtime prefers WASM + SIMD
  if (caps.has('wasm')) caps.add('onnxWasm');

  if (hasIndexedDb()) caps.add('indexedDb');

  return caps;
}

// ─── Memoised access ───────────────────────────────────────────────────────

let _cached: PlatformInfo | null = null;

/**
 * Get a memoised PlatformInfo snapshot.
 *
 * Cached because capabilities don't change during a session (a page refresh
 * or app restart is the normal invalidation mechanism). Call
 * `resetPlatformInfo()` to force re-detection (e.g. after test overrides or
 * capability changes in development).
 */
export function getPlatformInfo(): PlatformInfo {
  if (_override) return _override;
  if (_cached) return _cached;

  const kind = detectRuntimeKind();
  const os = detectOs();
  const capabilities = computeCapabilities();

  _cached = {
    kind,
    os,
    capabilities,
    hasTauriIpc: kind === 'tauri',
    hasNativeFs: kind === 'tauri',
    hasWebGpu: capabilities.has('webgpu'),
    hasWebWorker: capabilities.has('webWorker'),
    hasWasm: capabilities.has('wasm'),
  };

  return _cached;
}

/** Convenience: quick check for a specific capability. */
export function hasCapability(cap: PlatformCapability): boolean {
  return getPlatformInfo().capabilities.has(cap);
}

/** Convenience: is the runtime Tauri? */
export function isTauriRuntime(): boolean {
  return detectRuntimeKind() === 'tauri';
}

/** Convenience: is the runtime a browser/web? */
export function isWebRuntime(): boolean {
  return detectRuntimeKind() === 'web';
}

/**
 * Convenience: is the OS macOS?
 *
 * Calls `detectOs()` directly (not the memoised `getPlatformInfo()`)
 * so the result always reflects the current `navigator` state. This
 * matters in tests where `navigator.platform` / `navigator.userAgent`
 * is overridden per-test — the memoised cache would leak across files.
 * Replaces the 6+ duplicated `navigator.platform.includes('mac')`
 * checks scattered across the editor package.
 */
export function isMac(): boolean {
  return detectOs() === 'mac';
}

/**
 * Convenience: is the WebView engine WebKitGTK (Linux Tauri)?
 *
 * WebKitGTK has specific input/clipboard/canvas quirks that require
 * workarounds (pinch-zoom bridge, native clipboard fallback, canvas
 * capability detection). This consolidates the duplicated
 * `ua.includes('WebKit') && !ua.includes('Chrome')` checks.
 */
export function isWebKitGTK(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // WebKitGTK UA contains "AppleWebKit" but not "Chrome" or "Mac"
  return (
    ua.includes('AppleWebKit') &&
    !ua.includes('Chrome') &&
    !ua.includes('Mac') &&
    getPlatformInfo().os === 'linux'
  );
}
