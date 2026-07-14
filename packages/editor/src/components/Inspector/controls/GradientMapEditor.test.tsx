import type { GradientMapStop } from '@strata/engine';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GradientMapEditor } from './GradientMapEditor';

function makeDefaultStops(): GradientMapStop[] {
  return [
    { position: 0, color: [0, 0, 0, 255] as GradientMapStop['color'] },
    { position: 1, color: [255, 255, 255, 255] as GradientMapStop['color'] },
  ];
}

function findBar() {
  return screen.getByRole('slider', { name: /gradient map stop bar/i });
}

function findStop(index: number) {
  return within(findBar()).getByRole('button', {
    name: new RegExp(`^stop ${index} `, 'i'),
  });
}

describe('GradientMapEditor', () => {
  describe('render', () => {
    it('renders with default stops', () => {
      render(
        <GradientMapEditor
          stops={makeDefaultStops()}
          dither={false}
          preserveLuminosity={false}
          onChange={vi.fn()}
        />,
      );
      expect(findBar()).toBeInTheDocument();
      expect(findStop(1)).toBeInTheDocument();
      expect(findStop(2)).toBeInTheDocument();
    });
  });

  describe('add stop', () => {
    it('click on bar adds a stop', () => {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={makeDefaultStops()}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      const bar = findBar();
      Object.defineProperty(bar, 'getBoundingClientRect', {
        value: () => ({
          left: 0,
          right: 200,
          top: 0,
          bottom: 24,
          width: 200,
          height: 24,
          x: 0,
          y: 0,
        }),
        configurable: true,
      });
      fireEvent.pointerDown(bar, {
        button: 0,
        clientX: 100,
      });
      expect(onChange).toHaveBeenCalledOnce();
      const arg = onChange.mock.calls[0]![0] as { stops: unknown[] };
      expect(arg.stops).toHaveLength(3);
    });
  });

  describe('keyboard nudge', () => {
    function renderWithMiddleStop() {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={[
            { position: 0.5, color: [128, 128, 128, 255] },
            { position: 1, color: [255, 255, 255, 255] },
          ]}
          dither={false}
          preserveLuminosity={false}
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
      const arg = onChange.mock.calls[0]![0] as {
        stops: Array<{ position: number }>;
      };
      expect(arg.stops[stopIdx]!.position).toBeCloseTo(expected);
    }

    it('ArrowLeft nudges position down by 1%', () => {
      const { onChange, stop } = renderWithMiddleStop();
      fireEvent.keyDown(stop, { key: 'ArrowLeft' });
      expect(onChange).toHaveBeenCalledOnce();
      expectStopPosition(onChange, 0, 0.49);
    });

    it('ArrowRight nudges position up by 1%', () => {
      const { onChange, stop } = renderWithMiddleStop();
      fireEvent.keyDown(stop, { key: 'ArrowRight' });
      expect(onChange).toHaveBeenCalledOnce();
      expectStopPosition(onChange, 0, 0.51);
    });

    it('ArrowUp nudges position up by 5%', () => {
      const { onChange, stop } = renderWithMiddleStop();
      fireEvent.keyDown(stop, { key: 'ArrowUp' });
      expect(onChange).toHaveBeenCalledOnce();
      expectStopPosition(onChange, 0, 0.55);
    });

    it('ArrowDown nudges position down by 5%', () => {
      const { onChange, stop } = renderWithMiddleStop();
      fireEvent.keyDown(stop, { key: 'ArrowDown' });
      expect(onChange).toHaveBeenCalledOnce();
      expectStopPosition(onChange, 0, 0.45);
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
        <GradientMapEditor
          stops={[
            { position: 0.02, color: [0, 0, 0, 255] },
            { position: 1, color: [255, 255, 255, 255] },
          ]}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      fireEvent.keyDown(findStop(1), { key: 'ArrowDown' });
      expectStopPosition(onChange, 0, 0);
    });

    it('clamps ArrowUp at 1', () => {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={[
            { position: 0.97, color: [0, 0, 0, 255] },
            { position: 1, color: [255, 255, 255, 255] },
          ]}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      fireEvent.keyDown(findStop(1), { key: 'ArrowUp' });
      expectStopPosition(onChange, 0, 1);
    });
  });

  describe('remove stop', () => {
    it('Delete removes selected stop', () => {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={[
            { position: 0, color: [0, 0, 0, 255] },
            { position: 0.5, color: [128, 128, 128, 255] },
            { position: 1, color: [255, 255, 255, 255] },
          ]}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      fireEvent.keyDown(findStop(2), { key: 'Delete' });
      expect(onChange).toHaveBeenCalledOnce();
      const arg = onChange.mock.calls[0]![0] as { stops: unknown[] };
      expect(arg.stops).toHaveLength(2);
    });

    it('Backspace removes selected stop', () => {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={[
            { position: 0, color: [0, 0, 0, 255] },
            { position: 0.5, color: [128, 128, 128, 255] },
            { position: 1, color: [255, 255, 255, 255] },
          ]}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      fireEvent.keyDown(findStop(2), { key: 'Backspace' });
      expect(onChange).toHaveBeenCalledOnce();
      const arg = onChange.mock.calls[0]![0] as { stops: unknown[] };
      expect(arg.stops).toHaveLength(2);
    });

    it('guards at minimum 2 stops', () => {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={makeDefaultStops()}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      fireEvent.keyDown(findStop(1), { key: 'Delete' });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('drag-off removal', () => {
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

    it('removes stop when dragged off the bar', () => {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={[
            { position: 0, color: [0, 0, 0, 255] },
            { position: 0.5, color: [128, 128, 128, 255] },
            { position: 1, color: [255, 255, 255, 255] },
          ]}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      const stopBtn = findStop(2);
      const bar = findBar();
      Object.defineProperty(bar, 'getBoundingClientRect', {
        value: () => ({
          left: 0,
          right: 200,
          top: 0,
          bottom: 24,
          width: 200,
          height: 24,
          x: 0,
          y: 0,
        }),
        configurable: true,
      });

      fireEvent.pointerDown(stopBtn, { button: 0 });
      fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });
      flushRaf();
      onChange.mockClear();

      fireEvent.pointerUp(window);
      expect(onChange).toHaveBeenCalledOnce();
      const arg = onChange.mock.calls[0]![0] as { stops: unknown[] };
      expect(arg.stops).toHaveLength(2);
    });

    it('does not remove when dragged on the bar', () => {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={[
            { position: 0, color: [0, 0, 0, 255] },
            { position: 0.5, color: [128, 128, 128, 255] },
            { position: 1, color: [255, 255, 255, 255] },
          ]}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      const stopBtn = findStop(2);
      const bar = findBar();
      Object.defineProperty(bar, 'getBoundingClientRect', {
        value: () => ({
          left: 0,
          right: 200,
          top: 100,
          bottom: 120,
          width: 200,
          height: 20,
          x: 0,
          y: 100,
        }),
        configurable: true,
      });

      fireEvent.pointerDown(stopBtn, { button: 0 });
      fireEvent.pointerMove(window, { clientX: 100, clientY: 110 });
      flushRaf();

      fireEvent.pointerUp(window);

      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as {
        stops: { position: number }[];
      };
      expect(lastCall.stops).toHaveLength(3);
    });
  });

  describe('selected stop controls', () => {
    it('shows position and color for selected stop', () => {
      render(
        <GradientMapEditor
          stops={makeDefaultStops()}
          dither={false}
          preserveLuminosity={false}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByLabelText(/stop 1 position/i)).toBeInTheDocument();
    });
  });

  describe('toggles', () => {
    it('dither checkbox toggles dither', () => {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={makeDefaultStops()}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      fireEvent.click(screen.getByLabelText(/dither gradient map/i));
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange.mock.calls[0]![0]).toEqual({
        dither: true,
      });
    });

    it('preserveLuminosity checkbox toggles', () => {
      const onChange = vi.fn();
      render(
        <GradientMapEditor
          stops={makeDefaultStops()}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
        />,
      );
      fireEvent.click(screen.getByLabelText(/preserve luminosity/i));
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange.mock.calls[0]![0]).toEqual({
        preserveLuminosity: true,
      });
    });
  });

  describe('undo coalescing', () => {
    it('calls onEditStart when stop drag begins', () => {
      const onChange = vi.fn();
      const onEditStart = vi.fn();
      const onEditEnd = vi.fn();
      render(
        <GradientMapEditor
          stops={makeDefaultStops()}
          dither={false}
          preserveLuminosity={false}
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
        <GradientMapEditor
          stops={makeDefaultStops()}
          dither={false}
          preserveLuminosity={false}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />,
      );
      fireEvent.pointerDown(findStop(1), { button: 0 });
      fireEvent.pointerUp(window);
      expect(onEditEnd).toHaveBeenCalledTimes(1);
    });
  });
});
