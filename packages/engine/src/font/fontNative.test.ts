/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('native system font bridge', () => {
  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('uses the nested request contract and returns exact bytes', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = true;
    const invoke = vi.fn(async () => [0, 1, 2, 255]);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }));

    const { loadSystemFontFace } = await import('./fontLoader');
    const bytes = await loadSystemFontFace('opaque-face-handle');

    expect(invoke).toHaveBeenCalledWith('load_system_font', {
      request: { handle: 'opaque-face-handle' },
    });
    expect(bytes && Array.from(new Uint8Array(bytes))).toEqual([0, 1, 2, 255]);
  });

  it('does not attempt native IPC in a browser runtime', async () => {
    const invoke = vi.fn();
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }));

    const { loadSystemFontFace } = await import('./fontLoader');
    await expect(loadSystemFontFace('opaque-face-handle')).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
