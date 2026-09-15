/**
 * Capability flags for honest UI (Phase 16).
 *
 * The browser build cannot detect or capture the same failures as the
 * desktop build. The UI describes what each surface actually supports —
 * never presenting browser crash detection as complete when the tab can be
 * terminated before a record is written.
 */

import type { RuntimeKind } from './schema';

export interface CrashCapabilities {
  /** Rust panic hook writes emergency records (desktop only). */
  nativePanicCapture: boolean;
  /** Crash records survive a webview restart (disk/IDB-backed queue). */
  postmortemDialog: boolean;
  /** Tab crashes that JS cannot intercept can be detected (desktop webview). */
  tabCrashDetection: boolean;
  /** Hangs are detected with bounded, low-false-positive heuristics. */
  hangsDetection: boolean;
  /** Local diagnostics can be exported as a support bundle. */
  localDiagnosticsExport: boolean;
  /** A configured ingestion endpoint is available. */
  uploadTransport: boolean;
}

export function detectCrashCapabilities(runtime: RuntimeKind): CrashCapabilities {
  switch (runtime) {
    case 'tauri':
    case 'webview2':
    case 'webkitgtk':
    case 'wkwebview':
      return {
        nativePanicCapture: true,
        postmortemDialog: true,
        tabCrashDetection: true,
        hangsDetection: true,
        localDiagnosticsExport: true,
        uploadTransport: false, // set at configuration time, never defaulted
      };
    case 'browser':
      return {
        nativePanicCapture: false,
        postmortemDialog: true,
        tabCrashDetection: false,
        hangsDetection: true,
        localDiagnosticsExport: true,
        uploadTransport: false,
      };
  }
}
