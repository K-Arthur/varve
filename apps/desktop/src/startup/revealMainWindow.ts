/**
 * Tauri desktop: close the native splash window and reveal the main window.
 * Browser builds no-op — there is no native splash to manage.
 *
 * Research: https://v2.tauri.app/learn/splashscreen/ (accessed 2026-07-13)
 */

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Close the native splashscreen and show the main window.
 * Safe to call multiple times; failures are logged, not thrown.
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
  document.getElementById('strata-boot-fallback')?.remove();
}
