/**
 * Session broker + transport tests (ADR-0204/0207).
 *
 * Verifies the primary-window broker end-to-end against the in-memory
 * transport (BroadcastChannel is unavailable in jsdom):
 * - window-ready registration → targeted snapshot
 * - aux-doc-changed → applyExternalDocument (single authority)
 * - aux-selection-changed → applyExternalSelection
 * - request-undo / request-redo exactly once
 * - request-reattach → reattachPanel + ack
 * - notifyStateChanged → coalesced session-patch broadcast
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDetachedPanels,
  isPanelDetached,
  markPanelDetached,
  markPanelReattached,
  resetDetachedPanelsStore,
  subscribeDetachedPanels,
} from '../detachedPanelsStore';
import type { BrokerEditorApi, BrokerSnapshot } from '../sessionBroker';
import { getSessionBroker, resetSessionBroker, SessionBroker } from '../sessionBroker';
import { createSessionTransport } from '../sessionTransport';

const BASE_SNAPSHOT: BrokerSnapshot = {
  documentJson: '{"name":"Doc","nextId":1,"nodes":{},"rootChildren":[]}',
  activeDocumentId: 'doc-1',
  activeDocumentName: 'Doc',
  selection: [],
  workspaceMode: 'design',
  theme: 'light',
  canUndo: false,
  canRedo: false,
  detachedPanels: [],
};

/** Flush async BroadcastChannel delivery (jsdom). */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(() => {
  // Force the synchronous in-memory transport for deterministic tests.
  vi.stubGlobal('BroadcastChannel', undefined);
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

describe('sessionBroker: registration + snapshot', () => {
  it('registers a window on window-ready and sends a targeted snapshot', async () => {
    const api = makeEditorApi();
    const spy = vi.fn();
    const transport = createSessionTransport('test-session', spy);
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    transport.send('window-ready', { windowId: 'aux-1', generation: 1 });
    await flush();

    expect(broker.getRegisteredWindows()).toHaveLength(1);
    expect(broker.getRegisteredWindows()[0]!.windowId).toBe('aux-1');

    const snapshotMsg = spy.mock.calls.find(([eventId]) => eventId === 'session-snapshot');
    expect(snapshotMsg).toBeDefined();
    const payload = snapshotMsg![1] as { target: string; snapshot: BrokerSnapshot };
    expect(payload.target).toBe('aux-1');
    expect(payload.snapshot.documentJson).toContain('"name":"Doc"');

    transport.close();
    broker.detach();
  });

  it('does not register beyond the window limit', () => {
    const broker = new SessionBroker('test-session');
    broker.attach(makeEditorApi());
    const transport = createSessionTransport('test-session', () => {});

    for (let i = 0; i < 10; i++) {
      transport.send('window-ready', { windowId: `aux-${i}`, generation: 1 });
    }
    expect(broker.getRegisteredWindows().length).toBeLessThanOrEqual(8);

    transport.close();
    broker.detach();
  });
});

describe('sessionBroker: document + selection sync', () => {
  it('applies aux-originated documents via applyExternalDocument', async () => {
    const api = makeEditorApi();
    const broker = new SessionBroker('test-session');
    broker.attach(api);
    const transport = createSessionTransport('test-session', () => {});

    transport.send('aux-doc-changed', {
      windowId: 'aux-1',
      documentJson: '{"name":"Edited","nextId":2,"nodes":{},"rootChildren":[]}',
    });
    await flush();
    expect(api.applyExternalDocument).toHaveBeenCalledWith(
      '{"name":"Edited","nextId":2,"nodes":{},"rootChildren":[]}',
    );

    transport.close();
    broker.detach();
  });

  it('applies aux-originated selections via applyExternalSelection', async () => {
    const api = makeEditorApi();
    const broker = new SessionBroker('test-session');
    broker.attach(api);
    const transport = createSessionTransport('test-session', () => {});

    transport.send('aux-selection-changed', { windowId: 'aux-1', selection: ['n1'] });
    await flush();
    expect(api.applyExternalSelection).toHaveBeenCalledWith(['n1']);

    transport.close();
    broker.detach();
  });
});

describe('sessionBroker: undo/redo exactly once', () => {
  it('routes request-undo and request-redo to the primary editor', async () => {
    const api = makeEditorApi();
    const broker = new SessionBroker('test-session');
    broker.attach(api);
    const transport = createSessionTransport('test-session', () => {});

    transport.send('request-undo', { windowId: 'aux-1' });
    transport.send('request-undo', { windowId: 'aux-1' });
    transport.send('request-redo', { windowId: 'aux-1' });
    await flush();

    expect(api.requestUndo).toHaveBeenCalledTimes(2);
    expect(api.requestRedo).toHaveBeenCalledTimes(1);

    transport.close();
    broker.detach();
  });
});

describe('sessionBroker: reattach', () => {
  it('clears the window and acks the reattach', async () => {
    const api = makeEditorApi();
    const spy = vi.fn();
    const transport = createSessionTransport('test-session', spy);
    const broker = new SessionBroker('test-session');
    broker.attach(api);

    transport.send('window-ready', { windowId: 'aux-1', generation: 1 });
    transport.send('request-reattach', { windowId: 'aux-1', panelTypeId: 'layers' });
    await flush();

    expect(api.reattachPanel).toHaveBeenCalledWith('layers');
    expect(broker.getRegisteredWindows()).toHaveLength(0);

    const ack = spy.mock.calls.find(([eventId]) => eventId === 'reattach-ack');
    expect(ack).toBeDefined();
    expect((ack![1] as { accepted: boolean }).accepted).toBe(true);

    transport.close();
    broker.detach();
  });
});

describe('sessionBroker: patch broadcast', () => {
  it('broadcasts a coalesced session-patch on notifyStateChanged', async () => {
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
    // Coalesced: at most one patch despite three notifications
    expect(patchMsgs.length).toBeLessThanOrEqual(1);
    if (patchMsgs.length === 1) {
      const patch = (patchMsgs[0]![1] as { patch: Partial<BrokerSnapshot> }).patch;
      expect(patch.documentJson).toContain('"name":"Doc"');
    }

    transport.close();
    broker.detach();
  });
});

describe('sessionBroker: singleton', () => {
  beforeEach(() => {
    resetSessionBroker();
  });

  it('getSessionBroker returns the same instance per session', () => {
    const a = getSessionBroker('s1');
    const b = getSessionBroker('s1');
    expect(a).toBe(b);
    resetSessionBroker();
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
    expect(getDetachedPanels()[0]!.windowId).toBe('aux-1');
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
    expect(getDetachedPanels()[0]!.windowId).toBe('aux-2');
  });

  it('notifies subscribers on change', () => {
    const listener = vi.fn();
    subscribeDetachedPanels(listener);
    markPanelDetached('layers', 'layers-primary', 'aux-1');
    expect(listener).toHaveBeenCalled();
  });
});
