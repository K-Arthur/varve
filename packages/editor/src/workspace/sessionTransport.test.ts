import { describe, expect, it, vi } from 'vitest';
import { createTauriEventTransport, type Transport } from './sessionTransport';

type NativeEventHandler = (event: { payload: unknown }) => void;

function createTauriEventBridge() {
  const listeners = new Map<string, Set<NativeEventHandler>>();
  return {
    listen: vi.fn(async (eventName: string, handler: NativeEventHandler) => {
      const handlers = listeners.get(eventName) ?? new Set<NativeEventHandler>();
      handlers.add(handler);
      listeners.set(eventName, handlers);
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0) listeners.delete(eventName);
      };
    }),
    emit: vi.fn(async (eventName: string, payload: unknown) => {
      for (const handler of [...(listeners.get(eventName) ?? [])]) {
        handler({ payload });
      }
    }),
  };
}

async function waitForTransport(transport: Transport): Promise<void> {
  await transport.ready?.();
}

describe('Tauri session transport', () => {
  it('queues an early auxiliary registration until the native listeners are armed', async () => {
    const bridge = createTauriEventBridge();
    const primaryMessages: Array<[string, unknown]> = [];
    const auxiliaryMessages: Array<[string, unknown]> = [];
    const primary = createTauriEventTransport(
      'panel-session-test',
      (eventId, payload) => primaryMessages.push([eventId, payload]),
      async () => bridge,
    );
    const auxiliary = createTauriEventTransport(
      'panel-session-test',
      (eventId, payload) => auxiliaryMessages.push([eventId, payload]),
      async () => bridge,
    );

    auxiliary.send('window-ready', { windowId: 'aux-1' });
    await Promise.all([waitForTransport(primary), waitForTransport(auxiliary)]);

    await vi.waitFor(() => {
      expect(primaryMessages).toEqual([['window-ready', { windowId: 'aux-1' }]]);
    });
    expect(auxiliaryMessages).toEqual([]);

    primary.send('session-snapshot', { target: 'aux-1' });
    await vi.waitFor(() => {
      expect(auxiliaryMessages).toEqual([['session-snapshot', { target: 'aux-1' }]]);
    });
    expect(primaryMessages).toEqual([['window-ready', { windowId: 'aux-1' }]]);

    primary.close();
    auxiliary.close();
  });

  it('exposes bridge setup failures to the transfer coordinator', async () => {
    const transport = createTauriEventTransport(
      'panel-session-test',
      () => {},
      async () => {
        throw new Error('event IPC unavailable');
      },
    );

    await expect(waitForTransport(transport)).rejects.toThrow('event IPC unavailable');
    transport.close();
  });
});
