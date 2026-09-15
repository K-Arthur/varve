// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  armBrowserFileLaunch,
  browserFileLaunchSupported,
  type LaunchedBrowserFile,
} from './browserFileLaunch';

interface FakeLaunchState {
  consumer: ((params: { files?: unknown[] }) => void) | null;
}

function installLaunchQueue(): FakeLaunchState {
  const state: FakeLaunchState = { consumer: null };
  Object.defineProperty(window, 'LaunchParams', {
    configurable: true,
    value: class LaunchParams {
      get files(): unknown[] {
        return [];
      }
    },
  });
  Object.defineProperty(window, 'launchQueue', {
    configurable: true,
    value: {
      setConsumer: (consumer: (params: { files?: unknown[] }) => void) => {
        state.consumer = consumer;
      },
    },
  });
  return state;
}

function teardown(): void {
  Reflect.deleteProperty(window, 'launchQueue');
  Reflect.deleteProperty(window, 'LaunchParams');
}

function fakeHandle(name: string, text: string, fail = false): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => {
      if (fail) throw new DOMException('denied', 'NotAllowedError');
      return new File([text], name, { type: 'application/json' });
    },
  } as unknown as FileSystemFileHandle;
}

describe('browser file launch intake', () => {
  afterEach(teardown);

  it('reports unsupported without the launch API and delivers nothing', async () => {
    const received: LaunchedBrowserFile[] = [];
    expect(browserFileLaunchSupported()).toBe(false);
    const dispose = await armBrowserFileLaunch((file) => received.push(file));
    expect(received).toEqual([]);
    dispose();
  });

  it('decodes launched file handles into name, text, and handle', async () => {
    const state = installLaunchQueue();
    expect(browserFileLaunchSupported()).toBe(true);

    const received: LaunchedBrowserFile[] = [];
    await armBrowserFileLaunch((file) => received.push(file));
    expect(state.consumer).not.toBeNull();

    const handle = fakeHandle('Launched.varve', '{"document":true}');
    state.consumer?.({ files: [handle] });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.name).toBe('Launched.varve');
    expect(received[0]?.text).toBe('{"document":true}');
    expect(received[0]?.handle).toBe(handle);
  });

  it('skips unreadable files and non-file entries without throwing', async () => {
    const state = installLaunchQueue();
    const received: LaunchedBrowserFile[] = [];
    await armBrowserFileLaunch((file) => received.push(file));

    state.consumer?.({ files: [fakeHandle('Denied.varve', '', true), { kind: 'directory' }] });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toEqual([]);
  });
});
