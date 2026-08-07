/**
 * Panel lifecycle + codec tests (ADR-0019 / M7).
 *
 * Verifies the generic detachable lifecycle and bounded local-state codec:
 * - Lifecycle captures panel-local DOM state (scroll, filter, tab)
 * - Lifecycle produces a bounded, typed PanelTransferSnapshot
 * - Codec enforces the 64 KiB budget (oversized state rejected)
 * - Codec round-trips state without DOM nodes/functions
 * - Wiring helper returns a shared instance
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  capturePanelDomState,
  createGenericPanelCodec,
  createGenericPanelLifecycle,
  getBuiltinDetachableWiring,
  PANEL_LOCAL_STATE_SCHEMA_VERSION,
  resetBuiltinDetachableWiring,
  restorePanelDomState,
} from '../panelLifecycle';
import { DEFAULT_PANEL_LOCAL_STATE_BYTES, type PanelTransferSnapshot } from '../panelRegistry';

function mountPanelRoot(panelTypeId: string): HTMLElement {
  const root = document.createElement('div');
  root.dataset.panelRoot = panelTypeId;
  root.innerHTML = `
    <div data-panel-scroll style="height: 200px; overflow: auto"></div>
    <input data-panel-filter value="shape" />
    <div data-panel-active-tab="properties"></div>
    <div data-node-id="n1" data-panel-expanded="true"></div>
    <div data-node-id="n2" data-panel-expanded="true"></div>
  `;
  document.body.appendChild(root);
  return root;
}

describe('panelLifecycle: DOM state capture', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('captures scroll, filter, active tab, and expanded nodes', () => {
    const root = mountPanelRoot('layers');
    const scrollable = root.querySelector('[data-panel-scroll]') as HTMLElement;
    scrollable.scrollTop = 42;

    const state = capturePanelDomState('layers');
    expect(state.scrollTop).toBe(42);
    expect(state.filter).toBe('shape');
    expect(state.activeTab).toBe('properties');
    expect(state.expandedNodeIds).toEqual(['n1', 'n2']);
  });

  it('returns empty state when no root exists', () => {
    expect(capturePanelDomState('unknown-panel')).toEqual({});
  });

  it('captures extra JSON state from data-panel-state', () => {
    const root = document.createElement('div');
    root.dataset.panelRoot = 'layers';
    root.dataset.panelState = JSON.stringify({ sortBy: 'name', view: 'list' });
    document.body.appendChild(root);

    const state = capturePanelDomState('layers');
    expect(state.extra).toEqual({ sortBy: 'name', view: 'list' });
  });

  it('ignores malformed extra state JSON', () => {
    const root = document.createElement('div');
    root.dataset.panelRoot = 'layers';
    root.dataset.panelState = '{broken';
    document.body.appendChild(root);

    const state = capturePanelDomState('layers');
    expect(state.extra).toBeUndefined();
  });
});

describe('panelLifecycle: restore', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('restores scroll and filter values', () => {
    mountPanelRoot('layers');
    restorePanelDomState('layers', { scrollTop: 99, filter: 'restored' });

    const root = document.querySelector('[data-panel-root="layers"]') as HTMLElement;
    const scrollable = root.querySelector('[data-panel-scroll]') as HTMLElement;
    const filter = root.querySelector('[data-panel-filter]') as HTMLInputElement;
    expect(scrollable.scrollTop).toBe(99);
    expect(filter.value).toBe('restored');
  });

  it('no-ops when root is missing', () => {
    expect(() => restorePanelDomState('nope', { scrollTop: 10 })).not.toThrow();
  });
});

describe('panelLifecycle: generic lifecycle', () => {
  it('produces a bounded typed snapshot via prepareForTransfer', async () => {
    const lifecycle = createGenericPanelLifecycle();
    mountPanelRoot('layers');

    const snapshot = await lifecycle.prepareForTransfer!({
      panelInstanceId: 'pi-1',
      originHostId: 'h1',
      destinationHostId: 'h2',
      documentId: 'doc-1',
      activeDocumentId: 'doc-1',
      panelTypeId: 'layers',
    });

    expect(snapshot.schemaVersion).toBe(PANEL_LOCAL_STATE_SCHEMA_VERSION);
    expect(snapshot.panelTypeId).toBe('layers');
    expect(snapshot.byteSize).toBeGreaterThan(0);
    expect(snapshot.byteSize).toBeLessThanOrEqual(DEFAULT_PANEL_LOCAL_STATE_BYTES);
  });

  it('restoreFromTransfer restores captured state', async () => {
    const lifecycle = createGenericPanelLifecycle();
    mountPanelRoot('layers');
    const snapshot = await lifecycle.prepareForTransfer!({
      panelInstanceId: 'pi-1',
      originHostId: 'h1',
      destinationHostId: 'h2',
      documentId: null,
      activeDocumentId: null,
      panelTypeId: 'layers',
    });

    // Simulate destination: fresh DOM, then restore
    document.body.innerHTML = '';
    mountPanelRoot('layers');
    await lifecycle.restoreFromTransfer!(snapshot);

    const root = document.querySelector('[data-panel-root="layers"]') as HTMLElement;
    const filter = root.querySelector('[data-panel-filter]') as HTMLInputElement;
    expect(filter.value).toBe('shape');
  });
});

describe('panelLifecycle: bounded codec', () => {
  it('encodes valid snapshots and enforces the byte budget', () => {
    const codec = createGenericPanelCodec();
    const snapshot: PanelTransferSnapshot = {
      schemaVersion: 1,
      panelTypeId: 'layers',
      state: { filter: 'x' },
      byteSize: 5,
    };
    const encoded = codec.encode(snapshot);
    expect(encoded).not.toBeNull();
    expect(encoded!.state).toEqual({ filter: 'x' });
  });

  it('rejects oversized snapshots', () => {
    const codec = createGenericPanelCodec(64);
    const snapshot: PanelTransferSnapshot = {
      schemaVersion: 1,
      panelTypeId: 'layers',
      state: { big: 'y'.repeat(1000) },
      byteSize: 2000,
    };
    expect(codec.encode(snapshot)).toBeNull();
  });

  it('rejects invalid snapshot shapes', () => {
    const codec = createGenericPanelCodec();
    expect(codec.encode(null)).toBeNull();
    expect(codec.encode('string' as unknown)).toBeNull();
    expect(codec.encode({} as unknown)).toBeNull();
  });

  it('decode returns the state payload', () => {
    const codec = createGenericPanelCodec();
    const snapshot: PanelTransferSnapshot = {
      schemaVersion: 1,
      panelTypeId: 'layers',
      state: { filter: 'y' },
      byteSize: 10,
    };
    expect(codec.decode(snapshot)).toEqual({ filter: 'y' });
  });

  it('decode rejects snapshots over budget', () => {
    const codec = createGenericPanelCodec(16);
    const snapshot: PanelTransferSnapshot = {
      schemaVersion: 1,
      panelTypeId: 'layers',
      state: { filter: 'y'.repeat(100) },
      byteSize: 500,
    };
    expect(codec.decode(snapshot)).toBeNull();
  });

  it('default budget is 64 KiB', () => {
    expect(DEFAULT_PANEL_LOCAL_STATE_BYTES).toBe(64 * 1024);
  });
});

describe('panelLifecycle: shared wiring', () => {
  beforeEach(() => {
    resetBuiltinDetachableWiring();
  });

  it('returns a shared instance with lifecycle + codec', () => {
    const wiring = getBuiltinDetachableWiring();
    expect(wiring.lifecycle.prepareForTransfer).toBeDefined();
    expect(wiring.lifecycle.restoreFromTransfer).toBeDefined();
    expect(wiring.localStateCodec.maxBytes).toBe(DEFAULT_PANEL_LOCAL_STATE_BYTES);
  });

  it('returns the same instance across calls', () => {
    expect(getBuiltinDetachableWiring()).toBe(getBuiltinDetachableWiring());
  });
});
