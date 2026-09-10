/**
 * @varve/platform — runtime backend detection.
 *
 * Returns a ready-to-use Platform by sniffing for the Tauri global injected by
 * `withGlobalTauri: true`. Falls back to the in-memory implementation so that
 * SSR, tests, and any non-browser/non-Tauri host still get a working surface
 * (every method resolves; native dialogs return null).
 *
 * Note: the web backend needs IndexedDB, which is async to open, so callers
 * wanting a web backend should use `createWebPlatform()` directly. This helper
 * returns a *synchronous* Platform — memory on the server, Tauri on desktop,
 * and memory (with a warning) if called in a browser that hasn't opted in.
 */

import { createMemoryPlatform } from './memory';
import type { Platform } from './platform';
import { createTauriPlatform } from './tauri';

interface TauriGlobalShape {
  __TAURI__?: unknown;
}

export type PlatformKind = 'web' | 'tauri' | 'memory';

export function detectPlatformKind(): PlatformKind {
  if (typeof window === 'undefined') return 'memory';
  const w = window as unknown as TauriGlobalShape;
  if (w.__TAURI__) return 'tauri';
  if (typeof indexedDB !== 'undefined') return 'web';
  return 'memory';
}

/**
 * Resolve a synchronous Platform. Tauri → Tauri backend; everything else →
 * in-memory. Use {@link createWebPlatform} explicitly for the IndexedDB-backed
 * browser experience (it is async to construct).
 */
export function detectPlatform(): Platform {
  // Static import is safe: tauri.ts has no top-level side effects and its
  // core() guard only fires when a method is actually called, so bundling it
  // into a web build is harmless (it never touches window.__TAURI__ there).
  if (detectPlatformKind() === 'tauri') {
    return createTauriPlatform();
  }
  return createMemoryPlatform();
}
