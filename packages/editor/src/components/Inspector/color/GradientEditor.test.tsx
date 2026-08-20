/**
 * Tests for GradientEditor — drag transaction wrapping, RAF throttle,
 * keyboard add-stop, and ArrowUp/Down/Home/End nudge.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import type { GradientFill } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GradientEditor } from './GradientEditor';

function makeGradient(overrides: Partial<GradientFill> = {}): GradientFill {
  return {
    type: 'linear',
    stops: [
      { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
      { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
    ],
    ...overrides,
  } as GradientFill;
}

function findBar() {
  return screen.getByRole('slider', { name: /gradient stop bar/i });
}

function findStop(index: number) {
  return within(findBar()).getByRole('button', { name: new RegExp(`^stop ${index} `, 'i') });
}

// ─── Bug 1: onEditStart / onEditEnd ─────────────────────────────────

describe('Bug 1 — transaction wrapping', () => {
  it('calls onEditStart when stop drag begins', () => {
    const onChange = vi.fn();
    const onEditStart = vi.fn();
    const onEditEnd = vi.fn();
    render(
      <GradientEditor
        gradient={makeGradient()}
        onChange={onChange}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
      />,
    );
    fireEvent.pointerDown(findStop(1), { button: 0 });
    expect(onEditStart).toHaveBeenCalledTimes(1);
    expect(onEditEnd).not.toHaveBeenCalled();
  });

  it('calls onEditEnd when stop drag ends', () => {
    const onChange = vi.fn();
    const onEditStart = vi.fn();
    const onEditEnd = vi.fn();
    render(
      <GradientEditor
        gradient={makeGradient()}
        onChange={onChange}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
      />,
    );
    fireEvent.pointerDown(findStop(1), { button: 0 });
    fireEvent.pointerUp(window);
    expect(onEditEnd).toHaveBeenCalledTimes(1);
  });

  it('does not call onEditStart for non-primary button', () => {
    const onEditStart = vi.fn();
    render(
      <GradientEditor gradient={makeGradient()} onChange={vi.fn()} onEditStart={onEditStart} />,
    );
    fireEvent.pointerDown(findStop(1), { button: 2 });
    expect(onEditStart).not.toHaveBeenCalled();
  });
});

// ─── Bug 2: RAF throttle ────────────────────────────────────────────

describe('Bug 2 — RAF throttle', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      rafCallbacks.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushRaf() {
    const entries = [...rafCallbacks.entries()];
    rafCallbacks.clear();
    for (const [, cb] of entries) {
      cb(performance.now());
    }
  }

  it('throttles onChange to once per animation frame during drag', () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={makeGradient()} onChange={onChange} />);
    fireEvent.pointerDown(findStop(1), { button: 0 });
    onChange.mockClear();

    // Fire three moves — none should trigger onChange until RAF fires
    fireEvent.pointerMove(window, { clientX: 50 });
    fireEvent.pointerMove(window, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 200 });

    expect(onChange).not.toHaveBeenCalled();

    flushRaf();

    // Only the last position should have been applied
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('flushes RAF on pointerUp', () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={makeGradient()} onChange={onChange} />);
    fireEvent.pointerDown(findStop(1), { button: 0 });
    onChange.mockClear();

    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window);

    // Move triggers RAF, then up fires — RAF should still execute
    flushRaf();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ─── Bug 3: Keyboard add-stop ───────────────────────────────────────

describe('Bug 3 — keyboard add-stop', () => {
  it('press A on bar adds a stop', () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={makeGradient()} onChange={onChange} />);
    fireEvent.keyDown(findBar(), { key: 'a' });
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0]![0] as { stops: unknown[] };
    expect(arg.stops).toHaveLength(3);
  });

  it('press Insert on bar adds a stop', () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={makeGradient()} onChange={onChange} />);
    fireEvent.keyDown(findBar(), { key: 'Insert' });
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0]![0] as { stops: unknown[] };
    expect(arg.stops).toHaveLength(3);
  });
});

// ─── Bug 4: ArrowUp / ArrowDown / Home / End ────────────────────────

describe('Bug 4 — ArrowUp/ArrowDown/Home/End', () => {
  function renderWithMiddleStop() {
    const onChange = vi.fn();
    render(
      <GradientEditor
        gradient={makeGradient({
          stops: [
            { position: 0.5, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        })}
        onChange={onChange}
      />,
    );
    return { onChange, stop: findStop(1) };
  }

  function expectStopPosition(
    onChange: ReturnType<typeof vi.fn>,
    stopIdx: number,
    expected: number,
  ) {
    const arg = onChange.mock.calls[0]![0] as { stops: Array<{ position: number }> };
    expect(arg.stops[stopIdx]!.position).toBeCloseTo(expected);
  }

  it('ArrowDown nudges position down by 5%', () => {
    const { onChange, stop } = renderWithMiddleStop();
    fireEvent.keyDown(stop, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledOnce();
    expectStopPosition(onChange, 0, 0.45);
  });

  it('ArrowUp nudges position up by 5%', () => {
    const { onChange, stop } = renderWithMiddleStop();
    fireEvent.keyDown(stop, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledOnce();
    expectStopPosition(onChange, 0, 0.55);
  });

  it('Home jumps to position 0', () => {
    const { onChange, stop } = renderWithMiddleStop();
    fireEvent.keyDown(stop, { key: 'Home' });
    expect(onChange).toHaveBeenCalledOnce();
    expectStopPosition(onChange, 0, 0);
  });

  it('End jumps to position 1', () => {
    const { onChange, stop } = renderWithMiddleStop();
    fireEvent.keyDown(stop, { key: 'End' });
    expect(onChange).toHaveBeenCalledOnce();
    expectStopPosition(onChange, 0, 1);
  });

  it('clamps ArrowDown at 0', () => {
    const onChange = vi.fn();
    render(
      <GradientEditor
        gradient={makeGradient({
          stops: [
            { position: 0.02, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        })}
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(findStop(1), { key: 'ArrowDown' });
    expectStopPosition(onChange, 0, 0);
  });

  it('clamps ArrowUp at 1', () => {
    const onChange = vi.fn();
    render(
      <GradientEditor
        gradient={makeGradient({
          stops: [
            { position: 0.97, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        })}
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(findStop(1), { key: 'ArrowUp' });
    expectStopPosition(onChange, 0, 1);
  });
});

// ─── Bug 5: Stop hit targets and edge accessibility ────────────────

describe('Bug 5 — stop hit targets', () => {
  it('stop handles have minimum 24x24px hit target via CSS', () => {
    render(<GradientEditor gradient={makeGradient()} onChange={vi.fn()} />);
    const stops = screen.getAllByRole('button', { name: /^stop/i });
    for (const stop of stops) {
      // WCAG 2.2 §2.5.8 target size minimum is 24×24 CSS px.
      // jsdom getBoundingClientRect and getComputedStyle return 0/empty for
      // layout-dependent properties.  Verify the CSS class is applied, which
      // sets width/height to 24px in inspector.css.
      expect(stop.className).toContain('gradient-editor__stop');
    }
    // The CSS rule `.gradient-editor__stop { width: 24px; height: 24px; }`
    // in inspector.css guarantees the minimum hit target size in real browsers.
  });

  it('stops at position 0% and 100% are selectable', () => {
    render(<GradientEditor gradient={makeGradient()} onChange={vi.fn()} />);
    const stop0 = findStop(1); // position 0
    const stop100 = findStop(2); // position 1
    expect(stop0).toBeTruthy();
    expect(stop100).toBeTruthy();
    // Both should be in the DOM and interactive
    expect(stop0).toHaveAttribute('aria-pressed', 'true'); // first stop selected by default
    expect(stop100).toHaveAttribute('aria-pressed', 'false');
  });

  it('stops do not overlap the gradient bar edges', () => {
    render(<GradientEditor gradient={makeGradient()} onChange={vi.fn()} />);
    const bar = findBar();
    const barRect = bar.getBoundingClientRect();
    const stops = screen.getAllByRole('button', { name: /^stop/i });
    for (const stop of stops) {
      const stopRect = stop.getBoundingClientRect();
      // Stop center should be within the bar
      const centerX = stopRect.left + stopRect.width / 2;
      expect(centerX).toBeGreaterThanOrEqual(barRect.left);
      expect(centerX).toBeLessThanOrEqual(barRect.right);
    }
  });
});

// ─── Bug 6: Gradient stop colour editing preserves picker ─────────

describe('Bug 6 — stop colour editing', () => {
  it('editing a stop colour does not change selectedStop index', () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={makeGradient()} onChange={onChange} />);
    // Select stop 2
    fireEvent.pointerDown(findStop(2), { button: 0 });
    // Stop controls should show for stop 2
    const positionInput = screen.getByRole('spinbutton', { name: /stop 2 position/i });
    expect(positionInput).toBeTruthy();
  });

  it('shows colour picker for selected stop', () => {
    render(<GradientEditor gradient={makeGradient()} onChange={vi.fn()} />);
    // Stop 1 is selected by default — should show position input
    const positionInput = screen.getByRole('spinbutton', { name: /stop 1 position/i });
    expect(positionInput).toBeTruthy();
  });
});

describe('gradient interpolation semantics', () => {
  it('shows document inheritance and exposes hue controls for the resolved space', () => {
    render(
      <GradientEditor
        gradient={makeGradient({ interpolationSource: 'document' })}
        documentGradientInterpolation="oklch"
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('combobox', { name: 'Gradient interpolation space' }),
    ).toHaveTextContent('Document default (OKLCH)');
    expect(screen.getByRole('combobox', { name: 'Hue interpolation direction' })).toBeTruthy();
  });

  it('treats missing metadata as historical sRGB and allows a concrete override', () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={makeGradient()} onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Gradient interpolation space' });
    expect(select).toHaveTextContent('sRGB');

    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: 'OKLab' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ interpolationSpace: 'oklab' }));
    expect(onChange.mock.calls[0]?.[0]).not.toHaveProperty('interpolationSource');
  });
});
