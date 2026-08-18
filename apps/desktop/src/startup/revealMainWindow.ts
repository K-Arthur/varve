/**
 * Tauri desktop: bring the main window forward once the app has mounted.
 *
 * There is no longer a native splash window. It kept `main` hidden until the
 * frontend asked for it, which meant any startup failure left the user on an
 * unclosable splash with no error — so the branded boot screen now lives in
 * index.html inside the main window instead, and shows a readable error if
 * startup fails.
 *
 * This is kept because showing an already-visible window is a harmless no-op
 * and it correctly focuses the window when the app is launched via an OS
 * "Open With" request — the intake itself lives in src-tauri/src/file_open.rs
 * (queued paths) and startup/osFileOpen.ts (drain + live events). Browser
 * builds no-op.
 */

import { isTauriRuntime } from '@varve/platform';

/**
 * Show and focus the main window. Idempotent; failures are logged, not thrown —
 * a focus failure must never be able to stop startup.
 */
export async function revealMainWindow(): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('close_splashscreen');
  } catch (err) {
    console.warn('[startup] Failed to reveal main window:', err);
  }
}

/**
 * Remove the inline pre-JS boot fallback painted from index.html.
 * Called once React is about to mount.
 */
export function dismissBootFallback(): void {
  document.getElementById('varve-boot-fallback')?.remove();
}
