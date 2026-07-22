import { beforeEach, describe, expect, it } from 'vitest';
import { resetProfile } from '../adaptiveProfile';
import { getFrameCount, getLastFrame, resetDiagnostics } from '../drawDiagnostics';
import { resetFrameTimings } from '../frameBudget';
import {
  beginFrame,
  endFrame,
  initCanvasPerf,
  renderPerfHud,
  resolveMemoryBudgets,
  setPerfHudEnabled,
} from '../perfRuntime';
import { SubtreeIrCache } from '../subtreeIrCache';

describe('perfRuntime', () => {
  beforeEach(() => {
    resetDiagnostics();
    resetFrameTimings();
    resetProfile();
    setPerfHudEnabled(false);
  });

  it('initCanvasPerf runs without error', () => {
    expect(() => initCanvasPerf()).not.toThrow();
  });

  it('endFrame is a no-op recording when the HUD is disabled', () => {
    const cache = new SubtreeIrCache();
    const start = beginFrame();
    endFrame({
      frameStart: start,
      frameIndex: 1,
      docVersion: 1,
      redrawCount: 0,
      nodeCount: 10,
      culledCount: 0,
      renderPath: 'compositor',
      wasDirty: true,
      partialRedraw: false,
      cache,
    });
    expect(getFrameCount()).toBe(0);
  });

  it('endFrame maps cache diagnostics into the recorded frame when the HUD is enabled', () => {
    setPerfHudEnabled(true);
    const cache = new SubtreeIrCache();
    cache.set('n1', 'hash1', { id: 'n1' } as never);
    cache.get('n1', 'hash1'); // hit
    cache.get('n2', 'hash2'); // miss

    const start = beginFrame();
    const profile = endFrame({
      frameStart: start,
      frameIndex: 7,
      docVersion: 3,
      redrawCount: 2,
      nodeCount: 42,
      culledCount: 5,
      renderPath: 'worker-cached',
      wasDirty: true,
      partialRedraw: true,
      cache,
    });

    const last = getLastFrame();
    expect(last).not.toBeNull();
    expect(last?.frameIndex).toBe(7);
    expect(last?.docVersion).toBe(3);
    expect(last?.redrawCount).toBe(2);
    expect(last?.nodeCount).toBe(42);
    expect(last?.culledCount).toBe(5);
    expect(last?.renderPath).toBe('worker-cached');
    expect(last?.wasDirty).toBe(true);
    expect(last?.partialRedraw).toBe(true);
    expect(last?.cacheHitCount).toBe(cache.diagnostics().hits);
    expect(last?.cacheBytes).toBe(cache.diagnostics().bytes);
    expect(last?.cacheEntries).toBe(cache.diagnostics().entries);

    expect(['quality', 'balanced', 'performance', 'constrained']).toContain(profile.tier);
  });

  it('renderPerfHud does not throw when the HUD is disabled and there is nothing to draw', () => {
    const fakeCtx = {
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      fillRect: () => {},
      fillText: () => {},
    } as unknown as CanvasRenderingContext2D;
    expect(() => renderPerfHud(fakeCtx, 800)).not.toThrow();
  });

  it('resolveMemoryBudgets returns tiered presets matching memoryBudget.ts', () => {
    expect(resolveMemoryBudgets('low').subtreeIrCacheBytes).toBe(10 * 1024 * 1024);
    expect(resolveMemoryBudgets('medium').subtreeIrCacheBytes).toBe(25 * 1024 * 1024);
    expect(resolveMemoryBudgets('high').subtreeIrCacheBytes).toBe(200 * 1024 * 1024);
    expect(resolveMemoryBudgets(undefined).subtreeIrCacheBytes).toBe(50 * 1024 * 1024);
  });
});
