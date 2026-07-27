// @vitest-environment jsdom

/**
 * Regression: canvas content must be redrawn when the document changes.
 *
 * CanvasArea's SVG overlays (name labels, selection box) are reactive and
 * reposition on every document/camera change. The painted <canvas> content is
 * not reactive — it only repaints when a canvas frame is scheduled. An effect
 * with `drawContent` in its dependency array schedules that frame whenever the
 * document (or camera) changes.
 *
 * That effect was accidentally deleted during a large typecheck-fix refactor,
 * so edits stopped repainting the canvas: overlays moved while the content
 * stayed stale, making name labels appear to "move" or "stick" relative to the
 * geometry. This test asserts a content-lane canvas frame is scheduled after a
 * document mutation so the regression can't silently return.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Record scheduled canvas frames by key without executing the (heavy) draw job,
// which keeps the assertion deterministic in jsdom (no RAF, no real paint).
const scheduledKeys: string[] = [];

vi.mock('../canvas/perfRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../canvas/perfRuntime')>();
  return {
    ...actual,
    scheduleCanvasFrame: vi.fn((key: string) => {
      scheduledKeys.push(key);
    }),
    cancelCanvasFrame: vi.fn(() => true),
  };
});

vi.mock('../render/workerHost', () => ({
  createRenderWorkerHost: vi.fn(() => null),
  isStaleResponse: vi.fn(() => false),
}));

vi.mock('@strata/compositor', () => ({
  createCompositorBackend: vi.fn(async () => ({
    backend: {
      id: 'canvas2d',
      init: vi.fn(async () => {}),
      beginFrame: vi.fn(),
      drawVectorItems: vi.fn(),
      compositeRasterLayer: vi.fn(),
      endFrame: vi.fn(),
      destroy: vi.fn(),
    },
    capabilities: { webgpu: false },
  })),
}));

vi.mock('@strata/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@strata/engine')>();
  return {
    ...actual,
    createEngine: vi.fn(async () => ({
      backend: 'stub',
      buildIr: async () => [],
      hitTest: async () => null,
    })),
  };
});

import { CanvasArea } from '../CanvasArea';
import { EditorProvider, useEditor } from '../context';

// Content-lane draw frames use the `canvas-content:` key prefix
// (createCanvasFrameKey('content')). The imperative requestContentDraw path
// uses `canvas-draw-content:` and the overlay lane uses `canvas-draw-overlay:`,
// so this prefix isolates the document-change-driven content redraw.
const CONTENT_KEY_PREFIX = 'canvas-content:';
const contentScheduleCount = () =>
  scheduledKeys.filter((k) => k.startsWith(CONTENT_KEY_PREFIX)).length;

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

afterEach(() => {
  cleanup();
  scheduledKeys.length = 0;
  vi.clearAllMocks();
});

describe('canvas redraw on document change', () => {
  it('schedules a content-lane canvas frame when a node is moved', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Capture() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider initialDocumentJson={docJson}>
        <div style={{ width: 400, height: 300 }}>
          <CanvasArea />
        </div>
        <Capture />
      </EditorProvider>,
    );

    // Let mount + async engine/compositor init settle so any startup draws are
    // already recorded, then measure against a stable baseline.
    await waitFor(() => expect(ctx).toBeDefined());
    const baseline = contentScheduleCount();

    // Mutate the document — this is exactly the interaction (a live move) that
    // stopped repainting the canvas when the scheduling effect was removed.
    ctx?.setNodePosition('r1', 50, 60);

    await waitFor(() => {
      expect(contentScheduleCount()).toBeGreaterThan(baseline);
    });
  });
});
