/**
 * Session transport (ADR-0207) — the message channel between the primary
 * window (session authority) and auxiliary panel windows.
 *
 * Uses Tauri's core event IPC between desktop webviews, BroadcastChannel for
 * browser popups, and a memory bus in non-browser environments (tests).
 * Tauri webviews do not have to share a WebKit browsing-context group, so a
 * BroadcastChannel-only path is not a reliable native transport. Messages
 * are SessionEnvelope-shaped payloads produced by the broker — this module
 * only carries them.
 *
 * API:
 * - Primary side: createSessionTransport(sessionId, onMessage) → send
 * - Auxiliary side: createSessionTransport(sessionId, onMessage) → send
 */

import { isTauriRuntime } from '@varve/platform';

export interface Transport {
  send(eventId: string, payload: unknown): void;
  close(): void;
  /** Resolves when an asynchronous native listener is ready to receive. */
  ready?(): Promise<void>;
}

const CHANNEL_PREFIX = 'varve-session';
const TAURI_CHANNEL_PREFIX = 'varve:session';

// ---------------------------------------------------------------------------
// In-memory bus (tests / non-browser)
// ---------------------------------------------------------------------------

type Listener = (eventId: string, payload: unknown) => void;

const memoryBuses = new Map<string, Set<Listener>>();

function createMemoryTransport(sessionId: string, onMessage: Listener): Transport {
  let bus = memoryBuses.get(sessionId);
  if (!bus) {
    bus = new Set();
    memoryBuses.set(sessionId, bus);
  }
  bus.add(onMessage);
  return {
    send(eventId, payload) {
      for (const listener of bus ?? []) {
        if (listener !== onMessage) listener(eventId, payload);
      }
    },
    close() {
      bus?.delete(onMessage);
      if (bus && bus.size === 0) memoryBuses.delete(sessionId);
    },
  };
}

// ---------------------------------------------------------------------------
// BroadcastChannel transport
// ---------------------------------------------------------------------------

function createBroadcastTransport(sessionId: string, onMessage: Listener): Transport | null {
  if (typeof BroadcastChannel === 'undefined') return null;

  const channelName = `${CHANNEL_PREFIX}-${sessionId}`;
  const channel = new BroadcastChannel(channelName);

  const handle = (event: MessageEvent) => {
    const data = event.data as { eventId?: string; payload?: unknown } | null;
    if (data && typeof data.eventId === 'string') {
      onMessage(data.eventId, data.payload);
    }
  };
  channel.addEventListener('message', handle);

  return {
    send(eventId, payload) {
      try {
        channel.postMessage({ eventId, payload });
      } catch (_err) {}
    },
    close() {
      channel.removeEventListener('message', handle);
      channel.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Tauri core-event transport
// ---------------------------------------------------------------------------

interface TauriEventBridge {
  listen(eventName: string, handler: (event: { payload: unknown }) => void): Promise<() => void>;
  emit(eventName: string, payload: unknown): Promise<void>;
}

type TauriEventBridgeLoader = () => Promise<TauriEventBridge>;

interface TauriTransportMessage {
  sourceId: string;
  eventId: string;
  payload: unknown;
}

let transportCounter = 0;

function createTransportSourceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  transportCounter += 1;
  return `transport-${Date.now().toString(36)}-${transportCounter}`;
}

function isTauriTransportMessage(value: unknown): value is TauriTransportMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Partial<TauriTransportMessage>;
  return typeof message.sourceId === 'string' && typeof message.eventId === 'string';
}

async function loadTauriEventBridge(): Promise<TauriEventBridge> {
  const { emit, listen } = await import('@tauri-apps/api/event');
  return { emit, listen };
}

/**
 * Tauri events are asynchronous to subscribe to. Queue early messages (most
 * importantly an auxiliary host's `window-ready`) until that listener exists,
 * and expose readiness so the primary can arm its listener before creating a
 * child webview. A source id avoids receiving our own app-wide events.
 */
export function createTauriEventTransport(
  sessionId: string,
  onMessage: Listener,
  loadBridge: TauriEventBridgeLoader = loadTauriEventBridge,
): Transport {
  const eventName = `${TAURI_CHANNEL_PREFIX}-${sessionId}`;
  const sourceId = createTransportSourceId();
  const queued: TauriTransportMessage[] = [];
  let bridge: TauriEventBridge | null = null;
  let unlisten: (() => void) | null = null;
  let closed = false;
  let emission = Promise.resolve();

  const scheduleEmission = (message: TauriTransportMessage) => {
    emission = emission
      .catch(() => undefined)
      .then(async () => {
        if (closed || !bridge) return;
        await bridge.emit(eventName, message);
      })
      .catch(() => {
        // A native window may be torn down while an event is in flight. The
        // broker's bounded reservation/hydration protocol owns recovery.
      });
  };

  const flush = () => {
    if (closed || !bridge || queued.length === 0) return;
    const pending = queued.splice(0, queued.length);
    for (const message of pending) scheduleEmission(message);
  };

  const initialization = loadBridge().then(async (loaded) => {
    const dispose = await loaded.listen(eventName, (event) => {
      const message = event.payload;
      if (!isTauriTransportMessage(message) || message.sourceId === sourceId) return;
      onMessage(message.eventId, message.payload);
    });
    if (closed) {
      await Promise.resolve(dispose()).catch(() => {});
      return;
    }
    bridge = loaded;
    unlisten = dispose;
    flush();
  });
  // The coordinator awaits ready() before a native transfer. Suppress a
  // separate unhandled-rejection channel when a host is already closing.
  void initialization.catch(() => {});

  return {
    send(eventId, payload) {
      if (closed) return;
      queued.push({ sourceId, eventId, payload });
      flush();
    },
    close() {
      if (closed) return;
      closed = true;
      queued.length = 0;
      const dispose = unlisten;
      unlisten = null;
      if (dispose) {
        try {
          void Promise.resolve(dispose()).catch(() => {});
        } catch {
          // Disposal is best-effort during a webview teardown.
        }
      }
    },
    ready() {
      return initialization;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSessionTransport(
  sessionId: string,
  onMessage: (eventId: string, payload: unknown) => void,
): Transport {
  if (isTauriRuntime()) return createTauriEventTransport(sessionId, onMessage);
  const broadcast = createBroadcastTransport(sessionId, onMessage);
  if (broadcast) return broadcast;
  return createMemoryTransport(sessionId, onMessage);
}

/** Reset the memory bus (tests only). */
export function resetSessionTransports(): void {
  memoryBuses.clear();
}
