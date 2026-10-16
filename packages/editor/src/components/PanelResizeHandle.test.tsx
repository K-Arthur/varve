// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CANVAS_MIN_WIDTH,
  defaultPanelWidth,
  PANEL_LIMITS,
  PanelResizeHandle,
  resolveDisplayWidths,
} from './PanelResizeHandle';

describe('resolveDisplayWidths', () => {
  it('returns the desired widths unchanged when the viewport has room', () => {
    const resolved = resolveDisplayWidths({ layers: 320, inspector: 400 }, 1920);
    expect(resolved).toEqual({ layers: 320, inspector: 400 });
  });

  it('shrinks the display value but never mutates the desired value', () => {
    const desired = { layers: 480, inspector: 600 };
    const resolved = resolveDisplayWidths(desired, 1000);
    // 1000 - 320 canvas minimum - 600 other panel leaves 80px for layers,
    // which is below the layers minimum, so the minimum wins and the canvas
    // yields. The point of the test is that `desired` is untouched.
    expect(resolved.layers).toBeLessThanOrEqual(desired.layers);
    expect(desired).toEqual({ layers: 480, inspector: 600 });
  });

  it('shares the shortfall between both panels instead of over-shrinking each', () => {
    // 1000 - 320 canvas minimum leaves 680px. Two 400px panels need 800px, so
    // 120px must come out in total. Clamping each against the other's desired
    // width instead gave 280 + 280 = 560px and left 120px of canvas unused.
    const resolved = resolveDisplayWidths({ layers: 400, inspector: 400 }, 1000);
    // Slack above each minimum is 220 (layers) and 160 (inspector): 120px comes
    // out 70 / 50.
    expect(resolved).toEqual({ layers: 331, inspector: 349 });
    expect((resolved.layers ?? 0) + (resolved.inspector ?? 0) + CANVAS_MIN_WIDTH).toBe(1000);
  });

  it('removes the shortfall in proportion to what each panel can give up', () => {
    const resolved = resolveDisplayWidths({ layers: 480, inspector: 300 }, 1000);
    // Shrinkable: layers 300, inspector 60. Shortfall 100 -> 83 / 17.
    expect(resolved.layers).toBe(397);
    expect(resolved.inspector).toBe(283);
    expect((resolved.layers ?? 0) + (resolved.inspector ?? 0)).toBeLessThanOrEqual(680);
  });

  it('never goes below a panel minimum and keeps the default-width side fixed', () => {
    const squeezed = resolveDisplayWidths({ layers: 480, inspector: 600 }, 900);
    expect(squeezed.layers).toBeGreaterThanOrEqual(PANEL_LIMITS.layers.min);
    expect(squeezed.inspector).toBeGreaterThanOrEqual(PANEL_LIMITS.inspector.min);
    const oneSided = resolveDisplayWidths({ layers: 480, inspector: null }, 1000);
    // The null inspector keeps its CSS default (288px at 1000px wide).
    expect(oneSided.inspector).toBeNull();
    expect(oneSided.layers).toBe(Math.round(1000 - 320 - defaultPanelWidth('inspector', 1000)));
  });

  it('passes nulls through (default CSS clamp owns those panels)', () => {
    expect(resolveDisplayWidths({ layers: null, inspector: null }, 1440)).toEqual({
      layers: null,
      inspector: null,
    });
  });
});

describe('PanelResizeHandle semantics', () => {
  it('removes the grid-only splitter while the dock tree owns resizing', () => {
    const onResize = vi.fn();
    const { rerender } = render(
      <PanelResizeHandle side="layers" width={180} onResize={onResize} visible={false} />,
    );
    expect(screen.queryByRole('separator')).toBeNull();
    rerender(<PanelResizeHandle side="layers" width={180} onResize={onResize} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(onResize).toHaveBeenCalledWith(196);
    rerender(<PanelResizeHandle side="layers" width={196} onResize={onResize} visible={false} />);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('exposes the default width when no persisted width exists', () => {
    render(<PanelResizeHandle side="layers" width={null} onResize={vi.fn()} />);

    const splitter = screen.getByRole('separator', { name: 'Resize layers panel' });
    expect(splitter).toHaveAttribute(
      'aria-valuenow',
      String(defaultPanelWidth('layers', window.innerWidth)),
    );
    expect(splitter).toHaveAttribute('aria-valuemin', String(PANEL_LIMITS.layers.min));
    expect(splitter).toHaveAttribute('aria-valuemax', String(PANEL_LIMITS.layers.max));
    expect(splitter).toHaveAttribute('aria-valuetext', expect.stringContaining('pixels'));
    expect(splitter).toHaveAttribute('aria-controls', 'editor-layers-panel');
  });

  it('exposes a persisted width and supports keyboard resize', () => {
    const onResize = vi.fn();
    render(<PanelResizeHandle side="inspector" width={360} onResize={onResize} />);

    const splitter = screen.getByRole('separator', { name: 'Resize inspector panel' });
    expect(splitter).toHaveAttribute('aria-valuenow', '360');
    expect(splitter).toHaveAttribute('aria-controls', 'editor-inspector-panel');

    fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith(376);
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(onResize).toHaveBeenCalledWith(PANEL_LIMITS.inspector.min);
  });
});
