// @vitest-environment jsdom

/**
 * Browser file-handle save contract: a chosen file must not be overwritten
 * after something outside this session changed it (cloud sync, another app,
 * another device, removable media), and a session must still be able to save
 * when IndexedDB is unavailable (private mode / blocked storage).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentHash } from '../pure';
import { chooseWebSaveTarget, writeWebSaveTarget } from '../web-save';

interface FakeWritable {
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function installFakePicker(initialText: string, name = 'Poster.varve') {
  const state = { text: initialText };
  const writable: FakeWritable = {
    write: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const handle = {
    kind: 'file' as const,
    name,
    getFile: vi.fn(async () => new File([state.text], name, { type: 'application/json' })),
    createWritable: vi.fn(async () => writable),
    queryPermission: vi.fn(async () => 'granted' as PermissionState),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
  };
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: vi.fn(async () => handle),
  });
  return { state, handle, writable };
}

describe('browser save-handle external-change guard', () => {
  beforeEach(() => {
    // IndexedDB unavailable: the handle stays in memory for this session,
    // which is also the private-mode path this contract must keep working.
    vi.stubGlobal('indexedDB', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });

  it('writes when the file still matches the session baseline', async () => {
    const { state, writable } = installFakePicker('{"rev":1}');
    const choice = await chooseWebSaveTarget('Poster');
    expect(choice.kind).toBe('target');
    if (choice.kind !== 'target') return;

    const target = choice.target;
    expect(target.kind).toBe('web-file-handle');
    if (target.kind !== 'web-file-handle') return;

    const contents = '{"rev":2}';
    const result = await writeWebSaveTarget(
      { ...target, expectedContentHash: contentHash(state.text) },
      contents,
    );

    expect(result.kind).toBe('written');
    expect(writable.write).toHaveBeenCalledWith(contents);
    expect(writable.close).toHaveBeenCalledTimes(1);
  });

  it('refuses to overwrite a file changed outside the session', async () => {
    const { state, handle, writable } = installFakePicker('{"rev":1}');
    const choice = await chooseWebSaveTarget('Poster');
    if (choice.kind !== 'target' || choice.target.kind !== 'web-file-handle') {
      throw new Error('expected a web file handle target');
    }

    // Another device (or Drive sync) replaced the file while it was open.
    state.text = '{"rev":99}';
    const result = await writeWebSaveTarget(
      { ...choice.target, expectedContentHash: contentHash('{"rev":1}') },
      '{"rev":2}',
    );

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.category).toBe('file-changed-externally');
      expect(result.error.message).toMatch(/Save As/);
    }
    expect(handle.createWritable).not.toHaveBeenCalled();
    expect(writable.write).not.toHaveBeenCalled();
  });

  it('writes without a baseline (first save has nothing to compare against)', async () => {
    installFakePicker('{"rev":1}');
    const choice = await chooseWebSaveTarget('Poster');
    if (choice.kind !== 'target') throw new Error('expected a target');

    const result = await writeWebSaveTarget(choice.target, '{"rev":2}');
    expect(result.kind).toBe('written');
  });
});
