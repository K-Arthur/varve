import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurveEditor } from './CurveEditor';

afterEach(cleanup);

describe('CurveEditor', () => {
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
    expect(screen.getByRole('graphics-document', { name: /curve editor/i })).toBeTruthy();
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
    expect(rBtn.getAttribute('aria-checked')).toBe('true');
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
});
