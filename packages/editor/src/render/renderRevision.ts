import { asRenderRevision, nextRenderRevision, type RenderRevision } from '@varve/shared';

export interface RenderRevisionInputs {
  documentVersion: number;
  variablesVersion: number | string;
  resourcesVersion: number | string;
  asyncResultsVersion: number | string;
  camera: { panX: number; panY: number; zoom: number; rotation: number };
  viewport: { width: number; height: number; dpr: number; surfaceVersion: number };
}

export interface RenderRevisionTracker {
  readonly current: RenderRevision;
  /** Advances only when an input capable of changing pixels changed. */
  observe(inputs: RenderRevisionInputs): RenderRevision;
  /** Forces invalidation for an external render input not represented above. */
  invalidate(): RenderRevision;
}

function inputsEqual(a: RenderRevisionInputs, b: RenderRevisionInputs): boolean {
  return (
    a.documentVersion === b.documentVersion &&
    a.variablesVersion === b.variablesVersion &&
    a.resourcesVersion === b.resourcesVersion &&
    a.asyncResultsVersion === b.asyncResultsVersion &&
    a.camera.panX === b.camera.panX &&
    a.camera.panY === b.camera.panY &&
    a.camera.zoom === b.camera.zoom &&
    a.camera.rotation === b.camera.rotation &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height &&
    a.viewport.dpr === b.viewport.dpr &&
    a.viewport.surfaceVersion === b.viewport.surfaceVersion
  );
}

export function createRenderRevisionTracker(initial = 0): RenderRevisionTracker {
  let current = asRenderRevision(initial);
  let previous: RenderRevisionInputs | null = null;

  return {
    get current() {
      return current;
    },
    observe(inputs) {
      if (previous === null || !inputsEqual(previous, inputs)) {
        current = nextRenderRevision(current);
        previous = { ...inputs, camera: { ...inputs.camera }, viewport: { ...inputs.viewport } };
      }
      return current;
    },
    invalidate() {
      current = nextRenderRevision(current);
      return current;
    },
  };
}

const canvasTrackers = new WeakMap<HTMLCanvasElement, RenderRevisionTracker>();

/** Observe the current pixel-producing inputs for one canvas surface. */
export function observeCanvasRenderRevision(
  canvas: HTMLCanvasElement,
  inputs: RenderRevisionInputs,
): RenderRevision {
  let tracker = canvasTrackers.get(canvas);
  if (!tracker) {
    tracker = createRenderRevisionTracker();
    canvasTrackers.set(canvas, tracker);
  }
  return tracker.observe(inputs);
}
