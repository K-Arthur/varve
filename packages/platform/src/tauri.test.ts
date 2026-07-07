import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTauriPlatform } from './tauri';

interface TestTauriGlobal {
  __TAURI__?: unknown;
}

const globalWithTauri = globalThis as TestTauriGlobal;
const originalTauri = globalWithTauri.__TAURI__;

afterEach(() => {
  globalWithTauri.__TAURI__ = originalTauri;
});

describe('createTauriPlatform', () => {
  it('saves binary files as ArrayBuffer IPC payloads instead of number arrays', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'plugin:dialog|save') return '/tmp/icon.svg';
      return null;
    });
    globalWithTauri.__TAURI__ = {
      core: { invoke },
      event: { listen: async () => () => {} },
    };

    const platform = createTauriPlatform();
    const path = await platform.saveBinaryFile(
      'icon.svg',
      new Uint8Array([60, 115, 118, 103]),
      'image/svg+xml',
      '.svg',
    );

    expect(path).toBe('/tmp/icon.svg');
    const writeCall = invoke.mock.calls.find(([cmd]) => cmd === 'write_binary_file');
    if (!writeCall) throw new Error('Expected write_binary_file invoke');
    const payload = writeCall[1] as { data?: unknown };
    expect(payload.data).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(payload.data as ArrayBuffer))).toEqual([60, 115, 118, 103]);
  });
});
