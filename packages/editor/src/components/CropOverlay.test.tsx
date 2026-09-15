// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CropTool } from '../tools/CropTool';
import { CropOverlay, computeCropResize } from './CropOverlay';

const bounds = { w: 200, h: 100 };
const start = { x: 20, y: 10, w: 100, h: 50 };

describe('computeCropResize', () => {
  it('resizes a single edge without changing the opposite edge', () => {
    expect(computeCropResize(start, 'e', 20, 0, bounds)).toEqual({
      x: 20,
      y: 10,
      w: 120,
      h: 50,
    });
  });

  it('preserves aspect ratio with Shift', () => {
    const next = computeCropResize(start, 'se', 20, 5, bounds, {
      preserveAspect: true,
    });
    expect(next.w / next.h).toBeCloseTo(start.w / start.h);
  });

  it('resizes around the crop center with Alt', () => {
    const next = computeCropResize(start, 'e', 10, 0, bounds, { centered: true });
    expect(next.x).toBe(10);
    expect(next.w).toBe(120);
    expect(next.y).toBe(10);
    expect(next.h).toBe(50);
  });

  it('combines centered and proportional resizing', () => {
    const next = computeCropResize(start, 'se', 10, 5, bounds, {
      centered: true,
      preserveAspect: true,
    });
    expect(next.x + next.w / 2).toBeCloseTo(start.x + start.w / 2);
    expect(next.y + next.h / 2).toBeCloseTo(start.y + start.h / 2);
    expect(next.w / next.h).toBeCloseTo(start.w / start.h);
  });

  it('uses explicit aspectRatio when provided', () => {
    const square = { x: 0, y: 0, w: 100, h: 100 };
    const next = computeCropResize(square, 'se', 30, 20, bounds, {
      preserveAspect: true,
      aspectRatio: 16 / 9,
    });
    expect(next.w / next.h).toBeCloseTo(16 / 9);
  });
});

describe('CropOverlay', () => {
  it('renders interaction chrome without a second preview canvas', () => {
    const tool = makeTool();
    const { container } = render(
      <CropOverlay
        tool={tool}
        screenBounds={{ x: 0, y: 0, w: 200, h: 100 }}
        imageSrc="data:image/png;base64,AA"
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('lets keyboard users resize a focused crop handle', () => {
    const setCropRect = vi.fn();
    const tool = makeTool({ setCropRect });
    render(
      <CropOverlay
        tool={tool}
        screenBounds={{ x: 0, y: 0, w: 200, h: 100 }}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize crop e' }), {
      key: 'ArrowLeft',
    });
    expect(setCropRect).toHaveBeenCalledWith({ x: 20, y: 10, w: 99, h: 50 });
  });

  it('commits when Enter is pressed while the crop overlay owns focus', () => {
    const onDone = vi.fn();
    render(
      <CropOverlay
        tool={makeTool()}
        screenBounds={{ x: 0, y: 0, w: 200, h: 100 }}
        onDone={onDone}
        onCancel={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('crop-overlay'), { key: 'Enter' });
    expect(onDone).toHaveBeenCalledOnce();
  });
});

function makeTool(overrides: Partial<Pick<CropTool, 'setCropRect'>> = {}): CropTool {
  const state = {
    viewport: { ...start },
    fillScale: 1,
    fillOffsetX: 0,
    fillOffsetY: 0,
    fillFit: 'crop' as const,
  };
  return {
    subscribe: () => () => {},
    getCropState: () => state,
    getCropRect: () => state.viewport,
    getNodeSize: () => bounds,
    setCropRect: vi.fn(),
    setFillOffset: vi.fn(),
    setFillScale: vi.fn(),
    ...overrides,
  } as unknown as CropTool;
}
