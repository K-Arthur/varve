import { describe, expect, it } from 'vitest';
import { createRenderRevisionTracker, type RenderRevisionInputs } from './renderRevision';

const BASE_INPUTS: RenderRevisionInputs = {
  documentVersion: 1,
  variablesVersion: 1,
  resourcesVersion: 1,
  asyncResultsVersion: 1,
  camera: { panX: 0, panY: 0, zoom: 1, rotation: 0 },
  viewport: { width: 800, height: 600, dpr: 1 },
};

describe('render revision tracker', () => {
  it('does not advance for identical inputs', () => {
    const tracker = createRenderRevisionTracker();
    const first = tracker.observe(BASE_INPUTS);
    expect(tracker.observe({ ...BASE_INPUTS })).toBe(first);
  });

  it.each([
    ['document', { documentVersion: 2 }],
    ['variables', { variablesVersion: 2 }],
    ['resources', { resourcesVersion: 2 }],
    ['async result', { asyncResultsVersion: 2 }],
  ])('advances for a changed %s revision', (_name, changed) => {
    const tracker = createRenderRevisionTracker();
    const first = tracker.observe(BASE_INPUTS);
    expect(tracker.observe({ ...BASE_INPUTS, ...changed })).toBe(first + 1);
  });

  it('advances for camera, surface, and explicit invalidation changes', () => {
    const tracker = createRenderRevisionTracker();
    const first = tracker.observe(BASE_INPUTS);
    const camera = tracker.observe({
      ...BASE_INPUTS,
      camera: { ...BASE_INPUTS.camera, panX: 5 },
    });
    const surface = tracker.observe({
      ...BASE_INPUTS,
      camera: { ...BASE_INPUTS.camera, panX: 5 },
      viewport: { ...BASE_INPUTS.viewport, dpr: 2 },
    });

    expect(camera).toBe(first + 1);
    expect(surface).toBe(camera + 1);
    expect(tracker.invalidate()).toBe(surface + 1);
  });

  it('copies observed nested values instead of retaining mutable caller state', () => {
    const tracker = createRenderRevisionTracker();
    const inputs = structuredClone(BASE_INPUTS);
    const first = tracker.observe(inputs);
    inputs.camera.zoom = 2;
    expect(tracker.observe(inputs)).toBe(first + 1);
  });
});
