/**
 * Tests for GradientEditor — drag transaction wrapping, RAF throttle,
 * keyboard add-stop, and ArrowUp/Down/Home/End nudge.
 */
import type { GradientFill } from '@strata/scene';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
