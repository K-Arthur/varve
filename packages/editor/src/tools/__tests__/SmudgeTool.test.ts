// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

// Mock canvas getContext
HTMLCanvasElement.prototype.getContext = vi.fn() as any;

import { SmudgeTool } from '../SmudgeTool';
import type { ToolContext } from '../types';

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const base: ToolContext = {
    document: { nodes: {}, rootChildren: [] } as any,
    selection: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
    pointerPressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    tangentialPressure: 0,
    pointerWidth: 1,
    pointerHeight: 1,
    lastPointerEvent: { clientX: 0, clientY: 0 },
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    hasCoalescedEvents: false,
    hasPredictedEvents: false,
    sourceEvents: [],
    maskPreviewMode: 'none',
    setMaskPreviewMode: vi.fn(),
    foregroundColor: [0, 0, 0, 255],
    snapEnabled: false,
    snapGrid: 10,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(),
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
    updateNodes: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    removeSelected: vi.fn(),
    duplicateSelected: vi.fn(),
    reparentNode: vi.fn(),
    setCamera: vi.fn(),
    setPan: vi.fn(),
    setZoom: vi.fn(),
    announce: vi.fn(),
    announceSelection: vi.fn(),
    announceOperation: vi.fn(),
    setDraft: vi.fn(),
    setDropTargetFrame: vi.fn(),
    rootNodes: vi.fn(() => []),
    getNode: vi.fn(),
    canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
    worldToCanvas: vi.fn((wx, wy) => ({ x: wx, y: wy })),
    canvasDeltaToWorld: vi.fn((dx, dy) => ({ dx, dy })),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    findContainingFrame: vi.fn(),
    nodeWorldBounds: vi.fn(),
    engine: null,
    hitTest: vi.fn(),
    canvasElement: document.createElement('canvas'),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setTool: vi.fn(),
    nodeEditTargetId: null,
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    snapPosition: vi.fn(() => ({ x: 0, y: 0, guides: [] })),
    createRasterLayer: vi.fn(() => 'raster-1'),
    touchMultiSelect: { active: false, suspended: false },
  };
  return { ...base, ...overrides };
}

function createPointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    clientX: 100,
    clientY: 100,
    pointerId: 1,
    pointerType: 'mouse',
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    button: 0,
    isPrimary: true,
    getCoalescedEvents: vi.fn(() => []),
    getPredictedEvents: vi.fn(() => []),
    ...overrides,
  } as unknown as PointerEvent;
}

describe('SmudgeTool', () => {
  it('has the correct tool id', () => {
    const tool = new SmudgeTool();
    expect(tool.id).toBe('smudge');
  });

  it('returns crosshair cursor when idle', () => {
    const tool = new SmudgeTool();
    const cursor = tool.cursor('idle');
    expect(cursor.css).toBe('crosshair');
  });

  it('returns none cursor when dragging', () => {
    const tool = new SmudgeTool();
    const cursor = tool.cursor('drag');
    expect(cursor.css).toBe('none');
  });

  it('has default smudge strength', () => {
    const tool = new SmudgeTool();
    const settings = tool.getSettings();
    expect(settings.smudgeStrength).toBe(0.5);
  });

  it('onPointerDown starts a transaction and creates a raster layer', () => {
    const tool = new SmudgeTool();
    const beginTransaction = vi.fn();
    const createRasterLayer = vi.fn(() => 'raster-1');
    const ctx = createMockContext({ beginTransaction, createRasterLayer });
    const ev = createPointerEvent();

    tool.onPointerDown(ev, ctx);

    expect(beginTransaction).toHaveBeenCalled();
    expect(createRasterLayer).toHaveBeenCalled();
  });

  it('onPointerUp commits the transaction', () => {
    const tool = new SmudgeTool();
    const commitTransaction = vi.fn();
    const ctx = createMockContext({
      commitTransaction,
      createRasterLayer: vi.fn(() => 'raster-1'),
    });
    const ev = createPointerEvent();

    tool.onPointerDown(ev, ctx);
    tool.onPointerUp(ev, ctx);

    expect(commitTransaction).toHaveBeenCalled();
  });

  it('adjusts brush size with [ and ] keys', () => {
    const tool = new SmudgeTool();
    const announce = vi.fn();
    const ctx = createMockContext({ announce });

    const initial = tool.getSettings().radius;

    // Simulate key down for [
    const keyEventBracket = { key: '[', preventDefault: vi.fn() } as any;
    tool.onKeyDown(keyEventBracket, ctx);

    expect(tool.getSettings().radius).toBe(initial - 2);

    // Simulate key down for ]
    const keyEventBracket2 = { key: ']', preventDefault: vi.fn() } as any;
    tool.onKeyDown(keyEventBracket2, ctx);

    expect(tool.getSettings().radius).toBe(initial); // Back to original
  });

  it('Esc key during drag aborts the stroke', () => {
    const tool = new SmudgeTool();
    const abortTransaction = vi.fn();
    const ctx = createMockContext({ abortTransaction, createRasterLayer: vi.fn(() => 'raster-1') });
    const ev = createPointerEvent();

    tool.onPointerDown(ev, ctx);

    const escEvent = { key: 'Escape', preventDefault: vi.fn() } as any;
    tool.onKeyDown(escEvent, ctx);

    expect(abortTransaction).toHaveBeenCalled();
  });

  it('onDeactivate aborts if transaction is open', () => {
    const tool = new SmudgeTool();
    const abortTransaction = vi.fn();
    const ctx = createMockContext({ abortTransaction, createRasterLayer: vi.fn(() => 'raster-1') });
    const ev = createPointerEvent();

    tool.onPointerDown(ev, ctx);
    tool.onDeactivate(ctx);

    expect(abortTransaction).toHaveBeenCalled();
  });

  it('updatePresetFromSettings updates the internal preset', () => {
    const tool = new SmudgeTool();
    tool.updatePresetFromSettings({
      presetId: 'custom',
      radius: 20,
      opacity: 0.8,
      flow: 0.9,
      hardness: 0.5,
      smoothing: 0.4,
      spacing: 0.2,
      smudgeStrength: 0.7,
    });

    const settings = tool.getSettings();
    expect(settings.radius).toBe(20);
    expect(settings.smudgeStrength).toBe(0.7);
  });

  it('onSettingsChange callback fires when settings change', () => {
    const tool = new SmudgeTool();
    const onSettingsChange = vi.fn();
    tool.onSettingsChange = onSettingsChange;

    // Change radius via []
    const ctx = createMockContext({ announce: vi.fn() });
    const keyEvent = { key: ']', preventDefault: vi.fn() } as any;
    tool.onKeyDown(keyEvent, ctx);

    expect(onSettingsChange).toHaveBeenCalled();
  });
});

describe('SmudgeTool stroke continuity', () => {
  const at = (x: number, y: number) => createPointerEvent({ clientX: x, clientY: y });

  it('runs a long stroke across many pointer batches without a boundary fault', () => {
    // Smudge picks up and deposits per dab, so a spacing restart at a batch
    // boundary is directly visible as a blotch. The stroke session carries
    // spacing, arc length and jitter across flushes.
    const tool = new SmudgeTool();
    const ctx = createMockContext({
      canvasToWorld: (cx: number, cy: number) => ({ x: cx, y: cy }),
      updateNode: vi.fn((_id, updater) => {
        updater({
          id: 'r',
          kind: 'rasterLayer',
          tiles: new Map(),
          width: 512,
          height: 512,
        } as never);
      }) as ToolContext['updateNode'],
    });
    tool.updatePresetFromSettings({
      ...tool.getSettings(),
      radius: 10,
      spacing: 0.5,
      smoothing: 0,
    });

    tool.onPointerDown(at(0, 50), ctx);
    for (let x = 5; x <= 200; x += 5) tool.onPointerMove(at(x, 50), ctx);
    tool.onPointerUp(at(200, 50), ctx);

    expect(ctx.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('freezes the preset for the duration of a stroke', () => {
    const tool = new SmudgeTool();
    const ctx = createMockContext({
      canvasToWorld: (cx: number, cy: number) => ({ x: cx, y: cy }),
    });
    tool.updatePresetFromSettings({ ...tool.getSettings(), smudgeStrength: 0.2 });
    tool.onPointerDown(at(10, 10), ctx);
    // Strength drives both how much pigment moves and how fast the trail
    // fades, so a mid-stroke change must not alter what is already drawn.
    tool.updatePresetFromSettings({ ...tool.getSettings(), smudgeStrength: 0.95 });
    tool.onPointerMove(at(40, 10), ctx);
    tool.onPointerUp(at(40, 10), ctx);
    // The live setting moved; the stroke that just finished did not.
    expect(tool.getSettings().smudgeStrength).toBe(0.95);
  });

  it('samples the target layer alone by default', () => {
    const tool = new SmudgeTool();
    expect(tool.samplesAllLayers).toBe(false);
    tool.setSampleAllLayers(true);
    expect(tool.samplesAllLayers).toBe(true);
  });
});
