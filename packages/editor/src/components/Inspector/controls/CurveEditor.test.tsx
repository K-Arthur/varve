import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurveEditor } from './CurveEditor';

afterEach(cleanup);

describe('CurveEditor', () => {
  it('applies a current-channel preset in one transaction with fresh point ids', async () => {
    const onChange = vi.fn(),
      start = vi.fn(),
      end = vi.fn();
    render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]}
        onChange={onChange}
        onDragStart={start}
        onDragEnd={end}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: /^Curve preset$/ }));
    fireEvent.click(await screen.findByRole('option', { name: /^Soft contrast$/ }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toMatchObject([
      { x: 0, y: 0 },
      { x: 0.25, y: 0.2 },
      { x: 0.75, y: 0.8 },
      { x: 1, y: 1 },
    ]);
    expect(new Set(onChange.mock.calls[0]![0].map((point: { id: string }) => point.id)).size).toBe(
      4,
    );
  });
  it('renders a curve editor with default identity line', () => {
    const onChange = () => {};
    render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('img', { name: /curve editor/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /rgb/i })).toBeTruthy();
  });

  it('renders with custom points', () => {
    const onChange = () => {};
    const { container } = render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 0.3, y: 0.7 },
          { x: 1, y: 1 },
        ]}
        onChange={onChange}
      />,
    );
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(3);
  });

  it('switches channel on radio button click', () => {
    const onChange = () => {};
    render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]}
        onChange={onChange}
      />,
    );
    const rBtn = screen.getByRole('radio', { name: /^R$/i });
    fireEvent.click(rBtn);
    // A native radio exposes selection through `checked`; `aria-checked` would
    // be a redundant override of built-in semantics.
    expect((rBtn as HTMLInputElement).checked).toBe(true);
  });

  it('reset button fires onChange with identity line', () => {
    const onChange = vi.fn();
    render(
      <CurveEditor
        value={[
          { x: 0.2, y: 0.8 },
          { x: 0.8, y: 0.2 },
        ]}
        onChange={onChange}
      />,
    );
    const resetBtn = screen.getByRole('button', { name: /reset curve/i });
    fireEvent.click(resetBtn);
    expect(onChange).toHaveBeenCalledTimes(1);
    const newPoints = onChange.mock.calls[0]?.[0];
    expect(newPoints).toBeDefined();
    expect(newPoints.length).toBe(2);
    expect(newPoints[0]?.x).toBe(0);
    expect(newPoints[0]?.y).toBe(0);
    expect(newPoints[1]?.x).toBe(1);
    expect(newPoints[1]?.y).toBe(1);
  });

  it('shows 4 channel buttons including RGB and individual channels', () => {
    const onChange = () => {};
    render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: /rgb/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^R$/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^G$/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^B$/i })).toBeTruthy();
  });

  it('calls onDragStart when pointer down on anchor', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]}
        onChange={vi.fn()}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    );
    const svg = screen.getByRole('img', { name: /curve editor/i });
    fireEvent.pointerDown(svg, { clientX: 30, clientY: 210 });
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('calls onDragEnd when pointer up', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]}
        onChange={vi.fn()}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    );
    const svg = screen.getByRole('img', { name: /curve editor/i });
    fireEvent.pointerDown(svg, { clientX: 30, clientY: 210 });
    fireEvent.pointerUp(svg);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('calls onDragStart/onDragEnd for keyboard arrow changes', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]}
        onChange={vi.fn()}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    );
    const svg = screen.getByRole('img', { name: /curve editor/i });

    fireEvent.pointerDown(svg, { clientX: 30, clientY: 210 });
    fireEvent.pointerUp(svg);
    onDragStart.mockClear();
    onDragEnd.mockClear();

    fireEvent.keyDown(svg, { key: 'ArrowRight' });
    expect(onDragStart).toHaveBeenCalledTimes(1);

    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('calls onDragStart/onDragEnd when adding a new point', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const onChange = vi.fn();
    render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]}
        onChange={onChange}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    );
    const svg = screen.getByRole('img', { name: /curve editor/i });
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 120 });
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('does not call onDragStart for reset', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    render(
      <CurveEditor
        value={[
          { x: 0.2, y: 0.8 },
          { x: 0.8, y: 0.2 },
        ]}
        onChange={vi.fn()}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    );
    const resetBtn = screen.getByRole('button', { name: /reset curve/i });
    fireEvent.click(resetBtn);
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('does not call onDragStart for double-click delete', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    render(
      <CurveEditor
        value={[
          { x: 0, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 1, y: 1 },
        ]}
        onChange={vi.fn()}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    );
    const svg = screen.getByRole('img', { name: /curve editor/i });
    fireEvent.doubleClick(svg, { clientX: 30, clientY: 210 });
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });
});
