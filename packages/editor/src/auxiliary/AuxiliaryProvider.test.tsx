// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BrokerEditorApi,
  type BrokerSnapshot,
  resetSessionBroker,
  SessionBroker,
} from '../workspace/sessionBroker';
import {
  type AuxiliarySessionContextValue,
  AuxiliarySessionProvider,
  useAuxiliarySession,
} from './AuxiliaryProvider';

const SNAPSHOT: BrokerSnapshot = {
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

function makeEditorApi(): BrokerEditorApi {
  return {
    getSessionId: () => 'aux-provider-test',
    getSnapshot: () => SNAPSHOT,
    applyExternalDocument: vi.fn(),
    applyExternalSelection: vi.fn(),
    requestUndo: vi.fn(),
    requestRedo: vi.fn(),
    reattachPanel: vi.fn(),
  };
}

function Probe({ onValue }: { onValue: (value: AuxiliarySessionContextValue) => void }) {
  onValue(useAuxiliarySession());
  return null;
}

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', undefined);
  resetSessionBroker();
});

afterEach(() => {
  cleanup();
  resetSessionBroker();
});

describe('AuxiliarySessionProvider', () => {
  it('sends panel-hydrated only after the rendered host explicitly acknowledges restoration', async () => {
    const broker = new SessionBroker('aux-provider-test');
    broker.attach(makeEditorApi());
    const ready = broker.reservePanelHost({
      transactionId: 'tx-provider-ready',
      windowId: 'panel_window_provider',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
    });
    let session: AuxiliarySessionContextValue | undefined;

    render(
      <AuxiliarySessionProvider
        windowId="panel_window_provider"
        sessionId="aux-provider-test"
        panelTypeIds={['layers']}
        transactionId="tx-provider-ready"
        panelInstanceId="layers-primary"
      >
        <Probe onValue={(value) => (session = value)} />
      </AuxiliarySessionProvider>,
    );

    await waitFor(() => {
      expect(session?.state.connected).toBe(true);
      expect(session?.state.externalState).toMatchObject({
        documentRevision: SNAPSHOT.documentRevision,
      });
      expect(session?.state.transfer).toMatchObject({
        transactionId: 'tx-provider-ready',
        panelTypeId: 'layers',
      });
    });
    expect(broker.getPendingPanelHosts()).toHaveLength(1);

    act(() => session?.acknowledgeHydration());

    await expect(ready).resolves.toMatchObject({
      transactionId: 'tx-provider-ready',
      windowId: 'panel_window_provider',
    });
    expect(broker.getPendingPanelHosts()).toEqual([]);

    broker.detach();
  });

  it('does not report a close during a StrictMode effect replay', async () => {
    const broker = new SessionBroker('aux-provider-test');
    broker.attach(makeEditorApi());
    const ready = broker.reservePanelHost({
      transactionId: 'tx-strict-mode',
      windowId: 'panel_window_strict',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
    });
    let session: AuxiliarySessionContextValue | undefined;

    render(
      <StrictMode>
        <AuxiliarySessionProvider
          windowId="panel_window_strict"
          sessionId="aux-provider-test"
          panelTypeIds={['layers']}
          transactionId="tx-strict-mode"
          panelInstanceId="layers-primary"
        >
          <Probe onValue={(value) => (session = value)} />
        </AuxiliarySessionProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(session?.state.transfer?.transactionId).toBe('tx-strict-mode'));
    act(() => session?.acknowledgeHydration());

    await expect(ready).resolves.toMatchObject({ windowId: 'panel_window_strict' });
    expect(broker.getRegisteredWindows()).toHaveLength(1);
    broker.detach();
  });
});
