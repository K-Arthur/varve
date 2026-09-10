/**
 * Live session broker tests (ADR-0204/0207).
 *
 * The in-memory transport exercises the same raw message boundary used by a
 * BroadcastChannel. These tests intentionally send malformed and stale
 * payloads as well as the normal registration/hydration handshake.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDetachedPanels,
  isPanelDetached,
  markPanelDetached,
  markPanelReattached,
  resetDetachedPanelsStore,
  subscribeDetachedPanels,
} from '../detachedPanelsStore';
import type { PanelTransferSnapshot } from '../panelRegistry';
import {
  clearPanelWindowDiagnostics,
  getPanelWindowDiagnostics,
  setPanelWindowDiagnosticsEnabledForTest,
} from '../panelWindowDiagnostics';
import {
  type BrokerEditorApi,
  type BrokerSnapshot,
  getSessionBroker,
  isSessionPatchMessage,
  resetSessionBroker,
  SESSION_BROKER_PROTOCOL_VERSION,
  SessionBroker,
  withBrokerMessageMetadata,
} from '../sessionBroker';
import { createSessionTransport } from '../sessionTransport';

const BASE_SNAPSHOT: BrokerSnapshot = {
  documentJson: '{"name":"Doc","nextId":1,"nodes":{},"rootChildren":[]}',
  documentRevision: 4,
  activeDocumentId: 'doc-1',
  activeDocumentName: 'Doc',
  selection: [],
  workspaceMode: 'design',
  theme: 'light',
  canUndo: false,
  canRedo: false,
  detachedPanels: [],
};

/** Flush an in-memory transport delivery into the current async turn. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function auxMessage<T extends Record<string, unknown>>(
  windowId: string,
  payload: T,
  generation = 1,
): T & { protocolVersion: number; windowId: string; generation: number } {
  return withBrokerMessageMetadata(windowId, generation, payload);
}

function sendWindowReady(
  transport: ReturnType<typeof createSessionTransport>,
  windowId = 'aux-1',
  panelTypeIds = ['layers'],
  payload: Record<string, unknown> = {},
  generation = 1,
): void {
  transport.send('window-ready', auxMessage(windowId, { panelTypeIds, ...payload }, generation));
}

beforeEach(() => {
  // Force the synchronous in-memory transport for deterministic tests.
  vi.stubGlobal('BroadcastChannel', undefined);
  resetSessionBroker();
});

afterEach(() => {
  resetSessionBroker();
  vi.useRealTimers();
});

function makeEditorApi(overrides: Partial<BrokerEditorApi> = {}): BrokerEditorApi {
  return {
    getSessionId: () => 'test-session',
    getSnapshot: () => BASE_SNAPSHOT,
    applyExternalDocument: vi.fn(),
    applyExternalSelection: vi.fn(),
    requestUndo: vi.fn(),
    requestRedo: vi.fn(),
    reattachPanel: vi.fn(),
    ...overrides,
  };
}

/** Register a real Model-A host through the same reservation admission path as production. */
function reserveAndRegister(
  broker: SessionBroker,
  transport: ReturnType<typeof createSessionTransport>,
  {
    windowId = 'aux-1',
    panelTypeId = 'layers',
    panelInstanceId = `${panelTypeId}-primary`,
    transactionId = `detach-${windowId}`,
    generation = 1,
  }: {
    windowId?: string;
    panelTypeId?: string;
    panelInstanceId?: string;
    transactionId?: string;
    generation?: number;
  } = {},
) {
  const ready = broker.reservePanelHost({
    transactionId,
    windowId,
    panelTypeId,
    panelInstanceId,
    generation,
  });
  // Most tests exercise a registered live host rather than completion. Keep
  // teardown rejections explicit so they never turn into unhandled promises.
  void ready.catch(() => {});
  sendWindowReady(
    transport,
    windowId,
    [panelTypeId],
    { transactionId, panelTypeId, panelInstanceId },
    generation,
  );
  return { ready, transactionId, windowId, panelTypeId, panelInstanceId, generation };
}

describe('sessionBroker: versioned registration + snapshot', () => {
  it('registers a versioned window-ready message and sends a targeted snapshot', async () => {
    const api = makeEditorApi();
    const spy = vi.fn();
    const transport = createSessionTransport('test-session', spy);
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    reserveAndRegister(broker, transport);
    await flush();

    expect(broker.getRegisteredWindows()).toEqual([
      expect.objectContaining({ windowId: 'aux-1', generation: 1, panelTypeIds: ['layers'] }),
    ]);

    const snapshotMsg = spy.mock.calls.find(([eventId]) => eventId === 'session-snapshot');
    expect(snapshotMsg).toBeDefined();
    const payload = snapshotMsg![1] as {
      protocolVersion: number;
      target: string;
      snapshot: BrokerSnapshot;
    };
    expect(payload.protocolVersion).toBe(SESSION_BROKER_PROTOCOL_VERSION);
    expect(payload.target).toBe('aux-1');
    expect(payload.snapshot.documentJson).toContain('"name":"Doc"');
    expect(payload.snapshot.documentRevision).toBe(BASE_SNAPSHOT.documentRevision);

    transport.close();
    broker.detach();
  });

  it('rejects an unversioned registration instead of trusting raw BroadcastChannel data', () => {
    const broker = new SessionBroker('test-session');
    broker.attach(makeEditorApi());
    const transport = createSessionTransport('test-session', () => {});

    transport.send('window-ready', { windowId: 'aux-1', generation: 1, panelTypeIds: ['layers'] });

    expect(broker.getRegisteredWindows()).toEqual([]);

    transport.close();
    broker.detach();
  });

  it('rejects a versioned but unreserved registration without disclosing a snapshot', async () => {
    const spy = vi.fn();
    const broker = new SessionBroker('test-session');
    broker.attach(makeEditorApi());
    const transport = createSessionTransport('test-session', spy);

    sendWindowReady(transport);
    await flush();

    expect(broker.getRegisteredWindows()).toEqual([]);
    expect(spy.mock.calls.find(([eventId]) => eventId === 'session-snapshot')).toBeUndefined();

    transport.close();
    broker.detach();
  });

  it('does not register beyond the window limit', () => {
    const broker = new SessionBroker('test-session');
    broker.attach(makeEditorApi());
    const transport = createSessionTransport('test-session', () => {});

    for (let i = 0; i < 10; i++) {
      reserveAndRegister(broker, transport, {
        windowId: `aux-${i}`,
        transactionId: `detach-${i}`,
      });
    }
    expect(broker.getRegisteredWindows()).toHaveLength(8);

    transport.close();
    broker.detach();
  });
});

describe('sessionBroker: transactional panel host readiness', () => {
  it('waits for a matching ready registration and panel-hydrated acknowledgement', async () => {
    setPanelWindowDiagnosticsEnabledForTest(true);
    clearPanelWindowDiagnostics();
    const api = makeEditorApi();
    const spy = vi.fn();
    const transport = createSessionTransport('test-session', spy);
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    const ready = broker.reservePanelHost({
      transactionId: 'detach-tx-1',
      windowId: 'panel_window_1',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
      transferSnapshot: {
        schemaVersion: 1,
        panelTypeId: 'layers',
        state: { scrollTop: 120 },
        byteSize: 18,
      },
    });

    sendWindowReady(transport, 'panel_window_1', ['layers'], {
      transactionId: 'detach-tx-1',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
    });
    await flush();

    const snapshotMsg = spy.mock.calls.find(([eventId]) => eventId === 'session-snapshot');
    expect(snapshotMsg?.[1]).toMatchObject({
      protocolVersion: SESSION_BROKER_PROTOCOL_VERSION,
      target: 'panel_window_1',
      transfer: {
        transactionId: 'detach-tx-1',
        panelTypeId: 'layers',
        panelInstanceId: 'layers-primary',
        transferSnapshot: {
          schemaVersion: 1,
          panelTypeId: 'layers',
          state: { scrollTop: 120 },
          byteSize: 18,
        },
      },
    });
    expect(broker.getPendingPanelHosts()).toHaveLength(1);

    transport.send(
      'panel-hydrated',
      auxMessage('panel_window_1', {
        transactionId: 'detach-tx-1',
        panelTypeId: 'layers',
        panelInstanceId: 'layers-primary',
      }),
    );

    await expect(ready).resolves.toEqual({
      transactionId: 'detach-tx-1',
      windowId: 'panel_window_1',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
    });
    expect(broker.getPendingPanelHosts()).toEqual([]);
    expect(api.reattachPanel).not.toHaveBeenCalled();
    expect(getPanelWindowDiagnostics().map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'destination-host-reserved',
        'destination-host-registered',
        'panel-hydration-started',
        'panel-hydrated',
      ]),
    );

    transport.close();
    broker.detach();
    setPanelWindowDiagnosticsEnabledForTest(null);
    clearPanelWindowDiagnostics();
  });

  it('times out a registered host that never acknowledges hydration and restores its panels', async () => {
    vi.useFakeTimers();
    const api = makeEditorApi();
    const transport = createSessionTransport('test-session', () => {});
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    const ready = broker.reservePanelHost({
      transactionId: 'detach-tx-timeout',
      windowId: 'panel_window_timeout',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
      timeoutMs: 250,
    });
    const rejected = expect(ready).rejects.toThrow('did not become ready');

    sendWindowReady(transport, 'panel_window_timeout', ['layers'], {
      transactionId: 'detach-tx-timeout',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
    });
    await vi.advanceTimersByTimeAsync(250);

    await rejected;
    expect(api.reattachPanel).toHaveBeenCalledTimes(1);
    expect(api.reattachPanel).toHaveBeenCalledWith('layers');
    expect(broker.getRegisteredWindows()).toEqual([]);

    transport.close();
    broker.detach();
  });

  it('allows a cold auxiliary route the full bounded default readiness window', async () => {
    vi.useFakeTimers();
    const api = makeEditorApi();
    const transport = createSessionTransport('test-session', () => {});
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    const ready = broker.reservePanelHost({
      transactionId: 'detach-tx-default-timeout',
      windowId: 'panel_window_default_timeout',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
    });

    sendWindowReady(transport, 'panel_window_default_timeout', ['layers'], {
      transactionId: 'detach-tx-default-timeout',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
    });
    await Promise.resolve();
    const rejected = expect(ready).rejects.toThrow('did not become ready');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(broker.getPendingPanelHosts()).toHaveLength(1);
    expect(api.reattachPanel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(api.reattachPanel).toHaveBeenCalledWith('layers');

    transport.close();
    broker.detach();
  });

  it('ignores a transaction identity mismatch until the reservation is explicitly aborted', async () => {
    const api = makeEditorApi();
    const transport = createSessionTransport('test-session', () => {});
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    const ready = broker.reservePanelHost({
      transactionId: 'detach-tx-expected',
      windowId: 'panel_window_expected',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
    });
    const rejected = expect(ready).rejects.toThrow('creation failed');

    sendWindowReady(transport, 'panel_window_expected', ['layers'], {
      transactionId: 'detach-tx-other',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
    });
    await flush();

    expect(broker.getRegisteredWindows()).toEqual([]);
    expect(broker.abortPanelHost('detach-tx-expected', 'Native creation failed.')).toBe(true);
    await rejected;

    transport.close();
    broker.detach();
  });

  it('rejects an unsafe transfer snapshot before a destination window is created', async () => {
    const broker = new SessionBroker('test-session');
    broker.attach(makeEditorApi());

    const unsafeSnapshot = {
      schemaVersion: 1,
      panelTypeId: 'layers',
      state: { callback: () => {} },
      byteSize: 1,
    };
    await expect(
      broker.reservePanelHost({
        transactionId: 'detach-tx-unsafe',
        windowId: 'panel_window_unsafe',
        panelTypeId: 'layers',
        panelInstanceId: 'layers-primary',
        transferSnapshot: unsafeSnapshot as unknown as PanelTransferSnapshot,
      }),
    ).rejects.toThrow('invalid identity');

    broker.detach();
  });

  it('requires the exact reserved generation and exactly one reserved panel', async () => {
    const broker = new SessionBroker('test-session');
    broker.attach(makeEditorApi());
    const transport = createSessionTransport('test-session', () => {});
    const ready = broker.reservePanelHost({
      transactionId: 'detach-tx-exact',
      windowId: 'panel_window_exact',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
      generation: 2,
    });
    const rejected = expect(ready).rejects.toThrow('exact admission test complete');

    sendWindowReady(
      transport,
      'panel_window_exact',
      ['layers', 'inspector'],
      {
        transactionId: 'detach-tx-exact',
        panelTypeId: 'layers',
        panelInstanceId: 'layers-primary',
      },
      2,
    );
    sendWindowReady(
      transport,
      'panel_window_exact',
      ['layers'],
      {
        transactionId: 'detach-tx-exact',
        panelTypeId: 'layers',
        panelInstanceId: 'layers-primary',
      },
      1,
    );
    await flush();

    expect(broker.getRegisteredWindows()).toEqual([]);
    expect(broker.getPendingPanelHosts()).toHaveLength(1);
    expect(broker.abortPanelHost('detach-tx-exact', 'exact admission test complete')).toBe(true);
    await rejected;

    transport.close();
    broker.detach();
  });
});

describe('sessionBroker: close, reload, and reattach recovery', () => {
  it('reattaches a registered Model-A panel once when a host closes (including duplicate close signals)', () => {
    const api = makeEditorApi();
    const broker = new SessionBroker('test-session');
    broker.attach(api);
    const transport = createSessionTransport('test-session', () => {});

    reserveAndRegister(broker, transport);
    const close = auxMessage('aux-1', {});
    transport.send('window-close', close);
    transport.send('window-close', close);

    expect(api.reattachPanel).toHaveBeenCalledTimes(1);
    expect(api.reattachPanel).toHaveBeenCalledWith('layers');
    expect(broker.getRegisteredWindows()).toEqual([]);

    transport.close();
    broker.detach();
  });

  it('clears a window and acks an in-band reattach request', async () => {
    const api = makeEditorApi();
    const spy = vi.fn();
    const transport = createSessionTransport('test-session', spy);
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    reserveAndRegister(broker, transport);
    transport.send('request-reattach', auxMessage('aux-1', { panelTypeIds: ['layers'] }));
    await flush();

    expect(api.reattachPanel).toHaveBeenCalledWith('layers');
    expect(broker.getRegisteredWindows()).toEqual([]);

    const ack = spy.mock.calls.find(([eventId]) => eventId === 'reattach-ack');
    expect(ack?.[1]).toMatchObject({
      protocolVersion: SESSION_BROKER_PROTOCOL_VERSION,
      windowId: 'aux-1',
      accepted: true,
      panelTypeIds: ['layers'],
    });

    transport.close();
    broker.detach();
  });
});

describe('sessionBroker: document + selection sync', () => {
  it('applies registered aux-originated documents via applyExternalDocument', async () => {
    const api = makeEditorApi();
    const broker = new SessionBroker('test-session');
    broker.attach(api);
    const transport = createSessionTransport('test-session', () => {});

    reserveAndRegister(broker, transport);
    transport.send(
      'aux-doc-changed',
      auxMessage('aux-1', {
        documentJson: '{"name":"Edited","nextId":2,"nodes":{},"rootChildren":[]}',
        baseDocumentRevision: BASE_SNAPSHOT.documentRevision,
      }),
    );
    await flush();
    expect(api.applyExternalDocument).toHaveBeenCalledWith(
      '{"name":"Edited","nextId":2,"nodes":{},"rootChildren":[]}',
    );

    transport.close();
    broker.detach();
  });

  it('rejects a stale full-document mutation and resyncs only that auxiliary host', async () => {
    const api = makeEditorApi();
    const spy = vi.fn();
    const transport = createSessionTransport('test-session', spy);
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    reserveAndRegister(broker, transport);
    await flush();
    spy.mockClear();

    const acceptedDocument = '{"name":"Accepted","nextId":2,"nodes":{},"rootChildren":[]}';
    transport.send(
      'aux-doc-changed',
      auxMessage('aux-1', {
        documentJson: acceptedDocument,
        baseDocumentRevision: BASE_SNAPSHOT.documentRevision,
      }),
    );
    await flush();

    transport.send(
      'aux-doc-changed',
      auxMessage('aux-1', {
        documentJson: '{"name":"Stale","nextId":3,"nodes":{},"rootChildren":[]}',
        baseDocumentRevision: BASE_SNAPSHOT.documentRevision,
      }),
    );
    await flush();

    expect(api.applyExternalDocument).toHaveBeenCalledTimes(1);
    expect(api.applyExternalDocument).toHaveBeenCalledWith(acceptedDocument);

    const resync = spy.mock.calls.find(([eventId]) => eventId === 'session-snapshot');
    expect(resync?.[1]).toMatchObject({
      target: 'aux-1',
      snapshot: {
        documentJson: acceptedDocument,
        documentRevision: BASE_SNAPSHOT.documentRevision + 1,
      },
    });

    transport.close();
    broker.detach();
  });

  it('hydrates a new host from an equally-versioned primary document replacement', async () => {
    let primarySnapshot = {
      ...BASE_SNAPSHOT,
      documentJson: '{"name":"Before detach","nextId":1,"nodes":{},"rootChildren":[]}',
    };
    const api = makeEditorApi({ getSnapshot: () => primarySnapshot });
    const spy = vi.fn();
    const transport = createSessionTransport('test-session', spy);
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    // Seed the broker cache from the first primary snapshot.
    reserveAndRegister(broker, transport, {
      windowId: 'aux-before',
      transactionId: 'detach-before',
    });
    await flush();

    // Loading or creating a document can replace JSON before the surrounding
    // provider increments its session revision. The primary remains the
    // authority when those revisions tie.
    primarySnapshot = {
      ...primarySnapshot,
      documentJson: '{"name":"Current primary","nextId":2,"nodes":{},"rootChildren":[]}',
    };
    reserveAndRegister(broker, transport, {
      windowId: 'aux-current',
      panelTypeId: 'inspector',
      panelInstanceId: 'inspector-primary',
      transactionId: 'detach-current',
    });
    await flush();

    const currentSnapshot = spy.mock.calls.find(
      ([eventId, payload]) => eventId === 'session-snapshot' && payload.target === 'aux-current',
    );
    expect(currentSnapshot?.[1]).toMatchObject({
      snapshot: {
        documentJson: primarySnapshot.documentJson,
        documentRevision: BASE_SNAPSHOT.documentRevision,
      },
    });

    transport.close();
    broker.detach();
  });

  it('applies registered aux-originated selections via applyExternalSelection', async () => {
    const api = makeEditorApi();
    const broker = new SessionBroker('test-session');
    broker.attach(api);
    const transport = createSessionTransport('test-session', () => {});

    reserveAndRegister(broker, transport);
    transport.send('aux-selection-changed', auxMessage('aux-1', { selection: ['n1'] }));
    await flush();
    expect(api.applyExternalSelection).toHaveBeenCalledWith(['n1']);

    transport.close();
    broker.detach();
  });

  it('does not accept unregistered or unversioned document mutations', async () => {
    const api = makeEditorApi();
    const broker = new SessionBroker('test-session');
    broker.attach(api);
    const transport = createSessionTransport('test-session', () => {});

    transport.send('aux-doc-changed', auxMessage('unknown', { documentJson: '{"name":"Nope"}' }));
    transport.send('aux-doc-changed', { windowId: 'unknown', documentJson: '{"name":"Nope"}' });
    await flush();

    expect(api.applyExternalDocument).not.toHaveBeenCalled();

    transport.close();
    broker.detach();
  });
});

describe('sessionBroker: undo/redo and broadcasts', () => {
  it('routes registered request-undo and request-redo to the primary editor', async () => {
    const api = makeEditorApi();
    const broker = new SessionBroker('test-session');
    broker.attach(api);
    const transport = createSessionTransport('test-session', () => {});

    reserveAndRegister(broker, transport);
    transport.send('request-undo', auxMessage('aux-1', {}));
    transport.send('request-undo', auxMessage('aux-1', {}));
    transport.send('request-redo', auxMessage('aux-1', {}));
    await flush();

    expect(api.requestUndo).toHaveBeenCalledTimes(2);
    expect(api.requestRedo).toHaveBeenCalledTimes(1);

    transport.close();
    broker.detach();
  });

  it('does not let a membership broadcast group a second panel into a Model-A host', async () => {
    const api = makeEditorApi();
    const spy = vi.fn();
    const transport = createSessionTransport('test-session', spy);
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    reserveAndRegister(broker, transport);
    broker.broadcastPanelAdded('inspector', 'aux-1');
    await flush();

    expect(spy.mock.calls.find(([eventId]) => eventId === 'panel-added')).toBeUndefined();
    expect(broker.getRegisteredWindows()[0]).toMatchObject({
      windowId: 'aux-1',
      panelTypeIds: ['layers'],
    });

    transport.close();
    broker.detach();
  });

  it('broadcasts a coalesced, versioned session patch on notifyStateChanged', async () => {
    const api = makeEditorApi();
    const spy = vi.fn();
    const transport = createSessionTransport('test-session', spy);
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    broker.notifyStateChanged();
    broker.notifyStateChanged();
    broker.notifyStateChanged();

    await new Promise((resolve) => setTimeout(resolve, 120));

    const patchMsgs = spy.mock.calls.filter(([eventId]) => eventId === 'session-patch');
    expect(patchMsgs).toHaveLength(1);
    expect(patchMsgs[0]?.[1]).toMatchObject({
      protocolVersion: SESSION_BROKER_PROTOCOL_VERSION,
      patch: {
        documentJson: expect.stringContaining('"name":"Doc"'),
        documentRevision: BASE_SNAPSHOT.documentRevision,
      },
    });

    transport.close();
    broker.detach();
  });

  it('requires documentRevision on every session patch at the transport boundary', () => {
    expect(
      isSessionPatchMessage({
        protocolVersion: SESSION_BROKER_PROTOCOL_VERSION,
        patch: { documentJson: BASE_SNAPSHOT.documentJson },
      }),
    ).toBe(false);
  });
});

describe('sessionBroker: singleton session isolation', () => {
  it('returns the same instance only for the matching session id', () => {
    const a = getSessionBroker('s1');
    const b = getSessionBroker('s1');

    expect(a).toBe(b);
    expect(getSessionBroker('stale-session')).toBeNull();
  });
});

describe('detachedPanelsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDetachedPanelsStore();
  });

  it('marks panels detached and reports them', () => {
    markPanelDetached('layers', 'layers-primary', 'aux-1');
    expect(isPanelDetached('layers')).toBe(true);
    expect(getDetachedPanels()).toHaveLength(1);
    expect(getDetachedPanels()[0]?.windowId).toBe('aux-1');
  });

  it('reattach clears the record', () => {
    markPanelDetached('layers', 'layers-primary', 'aux-1');
    markPanelReattached('layers');
    expect(isPanelDetached('layers')).toBe(false);
    expect(getDetachedPanels()).toHaveLength(0);
  });

  it('singleton panels replace prior records of the same type', () => {
    markPanelDetached('layers', 'layers-primary', 'aux-1');
    markPanelDetached('layers', 'layers-primary', 'aux-2');
    expect(getDetachedPanels()).toHaveLength(1);
    expect(getDetachedPanels()[0]?.windowId).toBe('aux-2');
  });

  it('notifies subscribers on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDetachedPanels(listener);
    markPanelDetached('layers', 'layers-primary', 'aux-1');
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
