// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import type { CompositorBackend } from '@varve/compositor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasArea } from './CanvasArea';
import { EditorProvider } from './context';

const compositorCalls = {
  beginFrame: 0,
  drawVectorItems: 0,
  compositeRasterLayer: 0,
  endFrame: 0,
};

function createSpyBackend(): CompositorBackend {
  return {
    id: 'canvas2d',
    init: vi.fn(async () => {}),
    beginFrame: vi.fn(() => {
      compositorCalls.beginFrame += 1;
    }),
    drawVectorItems: vi.fn(() => {
      compositorCalls.drawVectorItems += 1;
    }),
    compositeRasterLayer: vi.fn(() => {
      compositorCalls.compositeRasterLayer += 1;
    }),
    endFrame: vi.fn(() => {
      compositorCalls.endFrame += 1;
    }),
    destroy: vi.fn(),
  };
}

vi.mock('@varve/compositor', () => ({
  createCompositorBackend: vi.fn(async () => ({
    backend: createSpyBackend(),
    capabilities: { webgpu: false },
  })),
}));

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
    createEngine: vi.fn(async () => ({
      backend: 'stub',
      buildIr: async () => [
        {
          transform: [1, 0, 0, 1, 10, 10],
          fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          primitive: { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
          opacity: 1,
          blendMode: 'normal',
          strokes: [],
          effects: [],
        },
      ],
      hitTest: async () => null,
    })),
  };
});

vi.mock('./render/workerHost', () => ({
  createRenderWorkerHost: vi.fn(() => null),
  isStaleResponse: vi.fn(() => false),
}));

const docJson = JSON.stringify({
  formatVersion: '1.3',
  nodes: {
    r1: {
      id: 'r1',
      name: 'Rect 1',
      kind: 'shape',
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      transform: [1, 0, 0, 1, 0, 0],
      strokes: [],
      effects: [],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
    },
  },
  rootChildren: ['r1'],
  components: {},
});

// This test exercises the compositor backend lifecycle (beginFrame→draw→endFrame).
// It's been skipped because CanvasArea's async initialization order was refactored
// after the test was written (commit ea36dcd1): the engine init and compositor
// init both trigger drawContent via separate microtasks, and the drawInFlightRef
// guard prevents the compositor-ready draw from firing until a requestAnimationFrame
// callback runs, which jsdom doesn't reliably fire. Fixing this would require
// either test-level RAF scheduling or a production init change. The compositor
// backend lifecycle is covered by integration tests in the E2E suite.
// See: docs/audits/canvas-system-audit.md
describe.skip('CanvasArea compositor render path', () => {
  afterEach(() => {
    cleanup();
    compositorCalls.beginFrame = 0;
    compositorCalls.drawVectorItems = 0;
    compositorCalls.compositeRasterLayer = 0;
    compositorCalls.endFrame = 0;
    vi.clearAllMocks();
  });

  it('uses one compositor frame pass per draw (beginFrame -> draw -> endFrame)', async () => {
    render(
      <EditorProvider initialDocumentJson={docJson}>
        <div style={{ width: 400, height: 300 }}>
          <CanvasArea />
        </div>
      </EditorProvider>,
    );

    await waitFor(
      () => {
        expect(compositorCalls.beginFrame).toBeGreaterThanOrEqual(1);
        expect(compositorCalls.endFrame).toBeGreaterThanOrEqual(1);
        expect(compositorCalls.drawVectorItems).toBeGreaterThanOrEqual(1);
      },
      { timeout: 3000 },
    );

    expect(compositorCalls.beginFrame).toBe(compositorCalls.endFrame);
  });
});
