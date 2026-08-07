/**
 * Session transport (ADR-0207) — the message channel between the primary
 * window (session authority) and auxiliary panel windows.
 *
 * Uses BroadcastChannel when available (same-origin, both browser popups
 * and Tauri webviews); falls back to a memory bus in non-browser
 * environments (tests). Messages are SessionEnvelope-shaped payloads
 * produced by the broker — this module only carries them.
 *
 * API:
 * - Primary side: createPrimaryTransport(sessionId, onMessage) → send
 * - Auxiliary side: createAuxiliaryTransport(sessionId, onMessage) → send
 */

export interface Transport {
  send(eventId: string, payload: unknown): void;
  close(): void;
}

const CHANNEL_PREFIX = 'varve-session';

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
// Factory
// ---------------------------------------------------------------------------

export function createSessionTransport(
  sessionId: string,
  onMessage: (eventId: string, payload: unknown) => void,
): Transport {
  const broadcast = createBroadcastTransport(sessionId, onMessage);
  if (broadcast) return broadcast;
  return createMemoryTransport(sessionId, onMessage);
}

/** Reset the memory bus (tests only). */
export function resetSessionTransports(): void {
  memoryBuses.clear();
}
