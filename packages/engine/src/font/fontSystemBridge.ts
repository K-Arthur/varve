/**
 * Native system-font byte access.
 *
 * Keep this adapter independent from FontRegistry and FontLoader. Both the
 * runtime loader and the registry need the same opaque-handle contract, while
 * importing either one from the other would create a package-local cycle.
 */

import { isTauriRuntime as isTauri } from '@varve/platform';

/** Load the original artifact addressed by a native enumeration handle. */
export async function loadSystemFontFace(handle: string): Promise<ArrayBuffer | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = await invoke<number[] | null>('load_system_font', {
    request: { handle },
  });
  return bytes ? Uint8Array.from(bytes).buffer : null;
}
