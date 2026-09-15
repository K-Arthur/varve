import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Retry drain shortly after mount: on macOS the `Opened` run event can
 *  arrive a beat after the webview is up, and the event itself is not
 *  replayed — draining twice makes startup racing harmless. */
const STARTUP_DRAIN_RETRY_MS = 1500;

export type OsFileOpenHandler = (path: string) => void;

/**
 * Arm OS-level "Open With" intake (.varve / .strata file associations).
 *
 * Two channels, one outcome: the Rust side queues every opened path (ipc
 * command `take_pending_open_files`) and emits `varve:file-open` for paths
 * arriving while the app is already running. Draining at mount covers
 * startup opens that raced the webview; the event covers live opens; the
 * caller dedupes by path so the same file can never open twice.
 *
 * Browser builds short-circuit: there is no OS open event in a webview.
 */
export async function armOsFileOpen(handle: OsFileOpenHandler): Promise<() => void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return () => undefined;
  }

  const drain = async () => {
    try {
      const pending = (await invoke<string[]>('take_pending_open_files')) ?? [];
      for (const path of pending) handle(path);
    } catch {
      // Not a Tauri webview — nothing to drain.
    }
  };

  const unlisten = await listen<string[]>('varve:file-open', (event) => {
    for (const path of event.payload ?? []) handle(path);
  });

  void drain();
  const retry = window.setTimeout(() => void drain(), STARTUP_DRAIN_RETRY_MS);

  return () => {
    window.clearTimeout(retry);
    void unlisten();
  };
}
