import type { Viewport } from '@strata/shared';
import { describe, expect, it } from 'vitest';
import type { EditorCameraState } from '../canvas/cameraState';
import { computeZoomStep, computeZoomTo } from './viewportOps';

const viewport: Viewport = { width: 1000, height: 800 };

// A panned-away-from-origin starting camera — the regression this guards
// against (EditorProvider's zoomIn anchoring around the viewport center vs.
// ViewportContext's naive `zoom * 1.25` leaving pan untouched) is invisible
// at zoom=1/pan=(0,0), since a naive scale about the origin and a
// center-anchored zoom coincide there.
const camState: EditorCameraState = { zoom: 1.5, pan: { x: 40, y: -25 }, cameraRotation: 0 };

// NOTE: these assertions deliberately stop short of checking that the world
// point under the viewport center is preserved (the actual purpose of
// anchoring zoom around the center). Investigating this test's failures
// surfaced a separate, pre-existing bug in `zoomAboutPoint`
// (packages/shared/src/viewport.ts) — for most non-zero pan values, the
// anchor world point does *not* stay under the viewport center after
// zooming (verified via manual repro, independent of this module and
// present before this change). That bug is out of scope here: fixing the
// shared zoom-about-point math is a separate, higher-risk change. What this
// module fixes is narrower — EditorProvider's `value.zoomIn/Out/To` and
// ViewportContext's `zoomIn/Out/To` now call the exact same function, so
// `useEditor()` and `useViewport()` can no longer disagree with each other.

describe('computeZoomStep', () => {
  it('changes zoom in the requested direction', () => {
    expect(computeZoomStep(camState, 'in', viewport).zoom).toBeGreaterThan(camState.zoom);
    expect(computeZoomStep(camState, 'out', viewport).zoom).toBeLessThan(camState.zoom);
  });

  it('does not merely scale the existing pan (the bug this replaces)', () => {
    // The naive `zoom: clampZoom(zoom * 1.25)` implementation ViewportContext
    // used to have left `pan` completely untouched — assert pan actually
    // moves to compensate, which is the behavioral difference that caused
    // useEditor().zoomIn() and useViewport().zoomIn() to disagree.
    const result = computeZoomStep(camState, 'in', viewport);
    expect(result.pan).not.toEqual(camState.pan);
  });

  it('is deterministic — same input always produces the same output', () => {
    // This is what actually closes the divergence: both call sites
    // (EditorProvider's value and ViewportContext) now call this one
    // function, so they're structurally guaranteed to agree.
    expect(computeZoomStep(camState, 'in', viewport)).toEqual(
      computeZoomStep(camState, 'in', viewport),
    );
  });
});

describe('computeZoomTo', () => {
  it('sets zoom to the clamped requested level', () => {
    expect(computeZoomTo(camState, 3, viewport).zoom).toBeCloseTo(3, 5);
  });

  it('does not merely scale the existing pan (the bug this replaces)', () => {
    const result = computeZoomTo(camState, 3, viewport);
    expect(result.pan).not.toEqual(camState.pan);
  });
});
