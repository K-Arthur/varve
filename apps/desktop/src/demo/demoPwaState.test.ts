import { describe, expect, it, vi } from 'vitest';
import {
  createInstallPromptController,
  getOnlineStatus,
  queryServedFromCache,
  watchOnlineStatus,
} from './demoPwaState';

class FakeTarget {
  private listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function installPromptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('demo PWA install prompt', () => {
  it('defers the browser prompt and exposes it once', async () => {
    const target = new FakeTarget();
    const controller = createInstallPromptController(target);
    const event = installPromptEvent('accepted');
    target.dispatch('beforeinstallprompt', event);

    expect(event.defaultPrevented).toBe(true);
    expect(controller.getPending()).toBe(event);

    const outcome = await controller.prompt();
    expect(outcome).toBe('accepted');
    // A prompt can only be used once; the browser fires a new event if it can
    // offer installation again.
    expect(controller.getPending()).toBeNull();
    expect(await controller.prompt()).toBe('unavailable');
  });

  it('reports dismissal without leaving a pending prompt', async () => {
    const target = new FakeTarget();
    const controller = createInstallPromptController(target);
    target.dispatch('beforeinstallprompt', installPromptEvent('dismissed'));

    expect(await controller.prompt()).toBe('dismissed');
    expect(controller.getPending()).toBeNull();
  });

  it('ignores unrelated events and stops listening after dispose', () => {
    const target = new FakeTarget();
    const controller = createInstallPromptController(target);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    target.dispatch('beforeinstallprompt', new Event('beforeinstallprompt'));
    expect(controller.getPending()).toBeNull();

    target.dispatch('beforeinstallprompt', installPromptEvent('accepted'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    target.dispatch('beforeinstallprompt', installPromptEvent('accepted'));
    expect(listener).toHaveBeenCalledTimes(1);

    controller.dispose();
    expect(target.count('beforeinstallprompt')).toBe(0);
    expect(controller.getPending()).toBeNull();
  });
});

describe('demo online status', () => {
  it('treats navigator.onLine as a hint with an online default', () => {
    expect(getOnlineStatus(undefined)).toBe(true);
    expect(getOnlineStatus({})).toBe(true);
    expect(getOnlineStatus({ onLine: true })).toBe(true);
    expect(getOnlineStatus({ onLine: false })).toBe(false);
  });

  it('reports transitions and unsubscribes cleanly', () => {
    const target = new FakeTarget();
    const listener = vi.fn();
    const unsubscribe = watchOnlineStatus(target, listener);

    target.dispatch('offline', new Event('offline'));
    target.dispatch('online', new Event('online'));
    expect(listener.mock.calls).toEqual([[false], [true]]);

    unsubscribe();
    target.dispatch('offline', new Event('offline'));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(target.count('online')).toBe(0);
    expect(target.count('offline')).toBe(0);
  });
});

describe('service-worker connectivity query', () => {
  it('reports cache-served when the worker answered the navigation offline', async () => {
    const controller = {
      postMessage: (_message: unknown, ports?: Transferable[]) => {
        const port = ports?.[0] as MessagePort | undefined;
        port?.postMessage({ type: 'VARVE_DEMO_CONNECTIVITY_PONG', online: false });
      },
    } as unknown as ServiceWorker;

    expect(await queryServedFromCache(controller, 1000)).toBe(true);
  });

  it('reports online when the worker served from the network', async () => {
    const controller = {
      postMessage: (_message: unknown, ports?: Transferable[]) => {
        const port = ports?.[0] as MessagePort | undefined;
        port?.postMessage({ type: 'VARVE_DEMO_CONNECTIVITY_PONG', online: true });
      },
    } as unknown as ServiceWorker;

    expect(await queryServedFromCache(controller, 1000)).toBe(false);
  });

  it('returns null without a controller or an answer', async () => {
    expect(await queryServedFromCache(null)).toBeNull();
    const silent = { postMessage: () => undefined } as unknown as ServiceWorker;
    expect(await queryServedFromCache(silent, 20)).toBeNull();
  });
});
