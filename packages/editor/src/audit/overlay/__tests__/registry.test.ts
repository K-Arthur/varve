import { describe, expect, it } from 'vitest';
import { OverlayRegistry } from '../registry';
import type { OverlayContext, OverlayPrimitive, OverlayProvider } from '../types';

function mockContext(overrides?: Partial<OverlayContext>): OverlayContext {
  return {
    document: { nodes: {} } as any,
    zoom: 1,
    pan: { x: 0, y: 0 },
    cameraRotation: 0,
    viewport: { width: 1920, height: 1080 },
    getWorldBounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
    getWorldTransform: () => [1, 0, 0, 1, 0, 0] as any,
    hiddenNodeIds: new Set(),
    clippedNodeIds: new Set(),
    ...overrides,
  };
}

function mockProvider(id: string, primitives: OverlayPrimitive[], zOrder = 10): OverlayProvider {
  return {
    id,
    label: id,
    zOrder,
    interactive: false,
    enabled: true,
    getPrimitives: () => primitives,
  };
}

describe('OverlayRegistry', () => {
  it('registers and unregisters providers', () => {
    const r = new OverlayRegistry();
    expect(r.getAllProviders()).toHaveLength(0);

    r.register(mockProvider('test', []));
    expect(r.getAllProviders()).toHaveLength(1);
    expect(r.getProvider('test')).toBeDefined();

    r.unregister('test');
    expect(r.getAllProviders()).toHaveLength(0);
  });

  it('returns empty scan result with no providers', () => {
    const r = new OverlayRegistry();
    const result = r.scan(mockContext(), { x: -1000, y: -1000, w: 2000, h: 2000 }, 2000, 30, 1);
    expect(result.primitives).toHaveLength(0);
    expect(result.totalAvailable).toBe(0);
  });

  it('returns provider primitives from scan', () => {
    const r = new OverlayRegistry();
    r.register(
      mockProvider('test', [
        {
          kind: 'rect',
          bounds: { x: 0, y: 0, w: 50, h: 50 },
          style: { strokeColor: 'red', strokeWidth: 1 },
          findingId: 'test-1',
        },
      ]),
    );
    r.setToggleState({ masterEnabled: true, providerOverrides: {}, severityFilter: [] });

    const result = r.scan(mockContext(), { x: -1000, y: -1000, w: 2000, h: 2000 }, 2000, 30, 1);
    expect(result.primitives).toHaveLength(1);
    expect(result.totalAvailable).toBe(1);
  });

  it('respects master toggle (disabled = no results)', () => {
    const r = new OverlayRegistry();
    r.register(
      mockProvider('test', [
        {
          kind: 'rect',
          bounds: { x: 0, y: 0, w: 50, h: 50 },
          style: { strokeColor: 'red', strokeWidth: 1 },
          findingId: 'test-1',
        },
      ]),
    );
    r.setToggleState({ masterEnabled: false, providerOverrides: {}, severityFilter: [] });

    const result = r.scan(mockContext(), { x: -1000, y: -1000, w: 2000, h: 2000 }, 2000, 30, 1);
    expect(result.primitives).toHaveLength(0);
  });

  it('culls off-viewport primitives', () => {
    const r = new OverlayRegistry();
    r.register(
      mockProvider('test', [
        {
          kind: 'rect',
          bounds: { x: 10000, y: 10000, w: 50, h: 50 },
          style: { strokeColor: 'red', strokeWidth: 1 },
          findingId: 'test-1',
        },
      ]),
    );
    r.setToggleState({ masterEnabled: true, providerOverrides: {}, severityFilter: [] });

    const result = r.scan(mockContext(), { x: -100, y: -100, w: 200, h: 200 }, 2000, 30, 1);
    expect(result.primitives).toHaveLength(0);
  });

  it('caps primitives at maxPrimitives', () => {
    const r = new OverlayRegistry();
    const primitives: OverlayPrimitive[] = [];
    for (let i = 0; i < 100; i++) {
      primitives.push({
        kind: 'rect',
        bounds: { x: i * 10, y: 0, w: 5, h: 5 },
        style: { strokeColor: 'red', strokeWidth: 1 },
        findingId: `test-${i}`,
      });
    }
    r.register(mockProvider('test', primitives));
    r.setToggleState({ masterEnabled: true, providerOverrides: {}, severityFilter: [] });

    const result = r.scan(mockContext(), { x: -1000, y: -1000, w: 2000, h: 2000 }, 10, 30, 1);
    expect(result.primitives).toHaveLength(10);
    expect(result.displayed).toBe(10);
    expect(result.totalAvailable).toBe(100);
  });

  it('clusters badges within threshold', () => {
    const r = new OverlayRegistry();
    const badges: OverlayPrimitive[] = [
      {
        kind: 'badge',
        anchor: { x: 0, y: 0 },
        text: 'A',
        severity: 'error',
        findingId: 'badge-1',
        screenSpaceSize: true,
      },
      {
        kind: 'badge',
        anchor: { x: 5, y: 0 },
        text: 'B',
        severity: 'warning',
        findingId: 'badge-2',
        screenSpaceSize: true,
      },
      {
        kind: 'badge',
        anchor: { x: 200, y: 0 },
        text: 'C',
        severity: 'suggestion',
        findingId: 'badge-3',
        screenSpaceSize: true,
      },
    ];
    r.register(mockProvider('test', badges));
    r.setToggleState({ masterEnabled: true, providerOverrides: {}, severityFilter: [] });

    // clusterThresholdPx=30 at zoom=1 → 30 world px threshold
    const result = r.scan(mockContext(), { x: -1000, y: -1000, w: 2000, h: 2000 }, 2000, 30, 1);

    // badges at 0 and 5 should cluster, badge at 200 is separate
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].count).toBe(2);
    expect(result.clusters[0].findingIds).toEqual(['badge-1', 'badge-2']);
  });

  it('filters by severity', () => {
    const r = new OverlayRegistry();
    r.register(
      mockProvider('test', [
        {
          kind: 'badge',
          anchor: { x: 0, y: 0 },
          text: 'Error',
          severity: 'error',
          findingId: 'err-1',
          screenSpaceSize: true,
        },
        {
          kind: 'badge',
          anchor: { x: 10, y: 0 },
          text: 'Warning',
          severity: 'warning',
          findingId: 'warn-1',
          screenSpaceSize: true,
        },
      ]),
    );
    r.setToggleState({ masterEnabled: true, providerOverrides: {}, severityFilter: ['error'] });

    const result = r.scan(mockContext(), { x: -1000, y: -1000, w: 2000, h: 2000 }, 2000, 30, 1);
    expect(result.primitives).toHaveLength(1);
    expect(result.primitives[0].findingId).toBe('err-1');
    expect(result.totalAvailable).toBe(1);
  });

  it('respects provider-specific toggle override', () => {
    const r = new OverlayRegistry();
    r.register(
      mockProvider('provider-a', [
        {
          kind: 'rect',
          bounds: { x: 0, y: 0, w: 10, h: 10 },
          style: { strokeColor: 'red', strokeWidth: 1 },
          findingId: 'a-1',
        },
      ]),
    );
    r.register(
      mockProvider('provider-b', [
        {
          kind: 'rect',
          bounds: { x: 0, y: 0, w: 10, h: 10 },
          style: { strokeColor: 'blue', strokeWidth: 1 },
          findingId: 'b-1',
        },
      ]),
    );
    r.setToggleState({
      masterEnabled: true,
      providerOverrides: { 'provider-a': false },
      severityFilter: [],
    });

    const result = r.scan(mockContext(), { x: -1000, y: -1000, w: 2000, h: 2000 }, 2000, 30, 1);
    expect(result.primitives).toHaveLength(1);
    expect(result.primitives[0].findingId).toBe('b-1');
  });
});
