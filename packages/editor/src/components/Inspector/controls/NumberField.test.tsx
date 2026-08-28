import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EditorContextValue, EditorCtx } from '../../../context';
import { NumberField } from './NumberField';

afterEach(cleanup);

/** Stateful holder so sequential edits re-render the field with the new value. */
function Holder({
  initial,
  ...rest
}: { initial: number } & Omit<React.ComponentProps<typeof NumberField>, 'value' | 'onChange'>) {
  const [v, setV] = useState(initial);
  return <NumberField {...rest} value={v} onChange={setV} />;
}

describe('NumberField', () => {
  it('renders a real associated label and the value', () => {
    render(<NumberField label="Width" value={42} onChange={() => {}} />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('42');
  });

  it('includes the unit suffix in the accessible name', () => {
    render(<NumberField label="Width" value={10} unit="px" onChange={() => {}} />);
    // accessible name should include the unit
    expect(screen.getByLabelText('Width (px)')).toBeTruthy();
  });

  it('increments by step on ArrowUp', () => {
    let val = 50;
    render(<NumberField label="X" value={val} onChange={(v) => (val = v)} />);
    fireEvent.keyDown(screen.getByLabelText('X'), { key: 'ArrowUp' });
    expect(val).toBe(51);
  });

  it('increments by shiftStep on Shift+ArrowUp', () => {
    let val = 50;
    render(
      <NumberField label="X" value={val} step={1} shiftStep={10} onChange={(v) => (val = v)} />,
    );
    fireEvent.keyDown(screen.getByLabelText('X'), { key: 'ArrowUp', shiftKey: true });
    expect(val).toBe(60);
  });

  it('increments by altStep on Alt+ArrowUp', () => {
    let val = 50;
    render(
      <NumberField label="X" value={val} step={1} altStep={0.1} onChange={(v) => (val = v)} />,
    );
    fireEvent.keyDown(screen.getByLabelText('X'), { key: 'ArrowUp', altKey: true });
    expect(val).toBeCloseTo(50.1, 5);
  });

  it('decrements on ArrowDown and clamps to min', () => {
    let val = 5;
    const onChange = (v: number) => (val = v);
    render(<NumberField label="X" value={val} min={0} onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText('X'), { key: 'ArrowDown' });
    expect(val).toBe(4);
  });

  it('clamps to min across repeated decrements', () => {
    render(<Holder label="X" initial={3} min={0} max={10} />);
    const input = screen.getByLabelText('X');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 2
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 1
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 0
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // clamp 0
    expect((input as HTMLInputElement).value).toBe('0');
  });

  it('clamps to max across repeated increments', () => {
    render(<Holder label="X" initial={98} min={0} max={100} />);
    const input = screen.getByLabelText('X');
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // 99
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // 100
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // clamp 100
    expect((input as HTMLInputElement).value).toBe('100');
  });

  it('commits a typed number on Enter', () => {
    let val = 100;
    render(<NumberField label="W" value={val} onChange={(v) => (val = v)} />);
    const input = screen.getByLabelText('W');
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(val).toBe(200);
  });

  it('evaluates a math expression on commit', () => {
    let val = 0;
    render(<NumberField label="W" value={val} onChange={(v) => (val = v)} />);
    const input = screen.getByLabelText('W');
    fireEvent.change(input, { target: { value: '120/2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(val).toBe(60);
  });

  it('resolves {alias} math via the aliases prop', () => {
    let val = 0;
    render(
      <NumberField label="W" value={val} aliases={{ 'space-4': 16 }} onChange={(v) => (val = v)} />,
    );
    const input = screen.getByLabelText('W');
    fireEvent.change(input, { target: { value: '{space-4}+8' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(val).toBe(24);
  });

  it('flags invalid input with aria-invalid and an error message, and does not commit', () => {
    let val = 50;
    const onChange = vi.fn((v: number) => (val = v));
    render(<NumberField label="W" value={val} onChange={onChange} />);
    const input = screen.getByLabelText('W') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/not a valid/i)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the error after a valid commit', () => {
    render(<NumberField label="W" value={50} onChange={() => {}} />);
    const input = screen.getByLabelText('W') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByText(/not a valid/i)).toBeNull();
  });

  it('exposes spinbutton semantics with aria-valuetext', () => {
    render(<NumberField label="Opacity" value={80} unit="%" onChange={() => {}} />);
    const input = screen.getByLabelText('Opacity (%)');
    expect(input.getAttribute('role')).toBe('spinbutton');
    expect(input.getAttribute('aria-valuenow')).toBe('80');
    expect(input.getAttribute('aria-valuetext')).toBe('80%');
  });

  it('is keyboard-operable as a control (Home/End jump to min/max)', () => {
    let val = 50;
    render(<NumberField label="X" value={val} min={0} max={100} onChange={(v) => (val = v)} />);
    fireEvent.keyDown(screen.getByLabelText('X'), { key: 'Home' });
    expect(val).toBe(0);
    fireEvent.keyDown(screen.getByLabelText('X'), { key: 'End' });
    expect(val).toBe(100);
  });

  it('coalesces focused wheel changes into one transaction after 200ms idle', () => {
    vi.useFakeTimers();
    const beginTransaction = vi.fn();
    const commitTransaction = vi.fn();
    try {
      render(
        <EditorCtx.Provider
          value={{ beginTransaction, commitTransaction } as unknown as EditorContextValue}
        >
          <Holder label="X" initial={10} />
        </EditorCtx.Provider>,
      );
      const input = screen.getByLabelText('X') as HTMLInputElement;
      input.focus();

      fireEvent.wheel(input, { deltaY: -1 });
      fireEvent.wheel(input, { deltaY: -1 });

      expect(input.value).toBe('12');
      expect(beginTransaction).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(199);
      expect(commitTransaction).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(commitTransaction).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
