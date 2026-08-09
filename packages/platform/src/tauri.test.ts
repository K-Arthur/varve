// @vitest-environment jsdom
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
    const invoke = vi.fn(async (cmd: string, _args?: unknown) => {
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
    const saveCall = invoke.mock.calls.find(([cmd]) => cmd === 'plugin:dialog|save');
    if (!saveCall) throw new Error('Expected plugin:dialog|save invoke');
    const saveArgs = saveCall[1] as { options?: Record<string, unknown> };
    // Tauri 2 dialog plugin requires { options: { defaultPath, filters } }
    expect(saveArgs.options).toBeDefined();
    expect((saveArgs.options as Record<string, unknown>).defaultPath).toBe('icon.svg');
    const writeCall = invoke.mock.calls.find(([cmd]) => cmd === 'write_binary_file');
    if (!writeCall) throw new Error('Expected write_binary_file invoke');
    const payload = writeCall[1] as { data?: unknown };
    expect(payload.data).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(payload.data as ArrayBuffer))).toEqual([60, 115, 118, 103]);
  });

  it('wraps plugin:dialog|open arguments in options key', async () => {
    const invoke = vi.fn(async (cmd: string, _args?: unknown) => {
      if (cmd === 'plugin:dialog|open') return [{ path: '/tmp/test.strata', name: 'test.strata' }];
      if (cmd === 'home_read_text_file_approved') return '{"nodes":{}}';
      return null;
    });
    globalWithTauri.__TAURI__ = {
      core: { invoke },
      event: { listen: async () => () => {} },
    };

    const platform = createTauriPlatform();
    await platform.openDocumentFromDisk();
    const openCall = invoke.mock.calls.find(([cmd]) => cmd === 'plugin:dialog|open');
    if (!openCall) throw new Error('Expected plugin:dialog|open invoke');
    const openArgs = openCall[1] as { options?: Record<string, unknown> };
    expect(openArgs.options).toBeDefined();
    expect((openArgs.options as Record<string, unknown>).multiple).toBe(false);
  });

  it('wraps plugin:dialog|save arguments in options key for document save', async () => {
    const invoke = vi.fn(async (cmd: string, _args?: unknown) => {
      if (cmd === 'plugin:dialog|save') return '/tmp/test.strata';
      return null;
    });
    globalWithTauri.__TAURI__ = {
      core: { invoke },
      event: { listen: async () => () => {} },
    };
    const platform = createTauriPlatform();
    await platform.saveDocumentToDisk('test', '{"nodes":{}}');
    const saveCall = invoke.mock.calls.find(([cmd]) => cmd === 'plugin:dialog|save');
    if (!saveCall) throw new Error('Expected plugin:dialog|save invoke');
    const saveArgs = saveCall[1] as { options?: Record<string, unknown> };
    expect(saveArgs.options).toBeDefined();
    // New saves default to the canonical .varve extension.
    expect((saveArgs.options as Record<string, unknown>).defaultPath).toBe('test.varve');
    // New documents produce the canonical format only; .strata is not
    // offered as an equal output format (legacy files still open/import).
    const filters = (saveArgs.options as Record<string, unknown>).filters as Array<{
      extensions: string[];
    }>;
    expect(filters[0]?.extensions).toEqual(['varve']);
  });

  it('chooses one export folder and writes safe relative files beneath it', async () => {
    const invoke = vi.fn(async (cmd: string, _args?: unknown) => {
      if (cmd === 'plugin:dialog|open') return '/tmp/exports';
      return null;
    });
    globalWithTauri.__TAURI__ = {
      core: { invoke },
      event: { listen: async () => () => {} },
    };

    const platform = createTauriPlatform();
    expect(await platform.chooseExportFolder()).toBe('/tmp/exports');
    const path = await platform.writeBinaryFileToFolder(
      '/tmp/exports',
      'icons/logo.svg',
      new Uint8Array([1, 2, 3]),
    );

    expect(path).toBe('/tmp/exports/icons/logo.svg');
    expect(invoke).toHaveBeenCalledWith('plugin:dialog|open', {
      options: { directory: true, multiple: false },
    });
    expect(invoke).toHaveBeenCalledWith('write_binary_file', {
      path: '/tmp/exports/icons/logo.svg',
      data: expect.any(ArrayBuffer),
    });
    await expect(
      platform.writeBinaryFileToFolder('/tmp/exports', '../escape.svg', new Uint8Array()),
    ).rejects.toThrow('safe relative path');
  });
});
