import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../../../context/types';
import { EditorCtx } from '../../../context/types';
import { formatRestingValue, NumberField, stripFloatResidue } from './NumberField';

afterEach(cleanup);

/** Stateful holder so sequential edits re-render the field with the new value. */
function Holder({
  initial,
  ...rest
}: { initial: number } & Omit<React.ComponentProps<typeof NumberField>, 'value' | 'onChange'>) {
  const [v, setV] = useState(initial);
  return <NumberField {...rest} value={v} onChange={setV} />;
}

describe('formatRestingValue', () => {
  it('hides float residue without changing whole or short values', () => {
    expect(formatRestingValue(270.40000000000003)).toBe('270.4');
    expect(formatRestingValue(880.4000000001, 1)).toBe('880.4');
    expect(formatRestingValue(100)).toBe('100');
    expect(formatRestingValue(12.345)).toBe('12.35');
    expect(formatRestingValue(-0.0000001)).toBe('0');
  });

  it('keeps extra decimals when the field steps finer than 0.01', () => {
    expect(formatRestingValue(0.12345, 0.001)).toBe('0.123');
  });
});

describe('NumberField', () => {
  it('shows a rounded resting value without writing it back', () => {
    const onChange = vi.fn();
    render(<NumberField label="Width" value={270.40000000000003} onChange={onChange} />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;
    expect(input.value).toBe('270.4');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives a hidden-label field the full row instead of the label column', () => {
    const { container } = render(
      <NumberField label="Opacity" hideLabel value={50} unit="%" onChange={() => {}} />,
    );
    expect(container.querySelector('.insp-field--label-hidden')).not.toBeNull();
  });

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

  it('formats the resting display without changing the numeric value', () => {
    const onChange = vi.fn();
    render(
      <NumberField
        label="Width"
        value={42.123456}
        formatValue={(value) => value.toFixed(2)}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Width') as HTMLInputElement;
    expect(input.value).toBe('42.12');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(43.123456);
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

  it('coalesces repeated arrow edits into one transaction', () => {
    const beginTransaction = vi.fn();
    const commitTransaction = vi.fn();
    const abortTransaction = vi.fn();
    const value = {
      beginTransaction,
      commitTransaction,
      abortTransaction,
    } as unknown as EditorContextValue;
    render(
      <EditorCtx.Provider value={value}>
        <Holder label="X" initial={10} />
      </EditorCtx.Provider>,
    );
    const input = screen.getByLabelText('X');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp', repeat: true });
    fireEvent.keyUp(window, { key: 'ArrowUp' });
    expect((input as HTMLInputElement).value).toBe('12');
    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction).toHaveBeenCalledTimes(1);
    expect(abortTransaction).not.toHaveBeenCalled();
  });

  it('coalesces a focused wheel gesture into one transaction', () => {
    vi.useFakeTimers();
    try {
      const beginTransaction = vi.fn();
      const commitTransaction = vi.fn();
      const abortTransaction = vi.fn();
      const value = {
        beginTransaction,
        commitTransaction,
        abortTransaction,
      } as unknown as EditorContextValue;
      render(
        <EditorCtx.Provider value={value}>
          <Holder label="X" initial={10} draftKey="doc:a" />
        </EditorCtx.Provider>,
      );
      const input = screen.getByLabelText('X');
      (input as HTMLInputElement).focus();
      fireEvent.wheel(input, { deltaY: -1 });
      fireEvent.wheel(input, { deltaY: -1 });
      expect(beginTransaction).toHaveBeenCalledTimes(1);
      expect(commitTransaction).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      expect(commitTransaction).toHaveBeenCalledTimes(1);
      expect(abortTransaction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a wheel transaction when its target scope changes', () => {
    vi.useFakeTimers();
    try {
      const commitTransaction = vi.fn();
      const abortTransaction = vi.fn();
      const value = {
        beginTransaction: vi.fn(),
        commitTransaction,
        abortTransaction,
      } as unknown as EditorContextValue;
      const view = render(
        <EditorCtx.Provider value={value}>
          <NumberField label="X" value={10} draftKey="doc:a" onChange={() => {}} />
        </EditorCtx.Provider>,
      );
      const input = screen.getByLabelText('X');
      (input as HTMLInputElement).focus();
      fireEvent.wheel(input, { deltaY: -1 });
      view.rerender(
        <EditorCtx.Provider value={value}>
          <NumberField label="X" value={20} draftKey="doc:b" onChange={() => {}} />
        </EditorCtx.Provider>,
      );
      expect(abortTransaction).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(250);
      expect(commitTransaction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

  it('keeps bounded spinbuttons on an explicit flex basis', () => {
    render(
      <NumberField label="Opacity" value={80} min={0} max={100} unit="%" onChange={() => {}} />,
    );
    const input = screen.getByLabelText('Opacity (%)') as HTMLInputElement;
    expect(input.style.flex).toContain('0 1');
    expect(input.style.width).toContain('5ch');
  });

  it('keeps a bound value inspectable and requires explicit unbinding to edit', () => {
    const onChange = vi.fn();
    const onUnbind = vi.fn();
    render(
      <NumberField
        label="X"
        value={48}
        onChange={onChange}
        bindingLabel="Spacing"
        onUnbind={onUnbind}
        propertyState={{ kind: 'bound', value: 48, bindingId: 'spacing' }}
      />,
    );
    const input = screen.getByLabelText('X') as HTMLInputElement;
    expect(input.value).toBe('48');
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('aria-readonly')).toBe('true');
    expect(input.getAttribute('aria-valuetext')).toBe('Variable-bound value');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.change(input, { target: { value: '100' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Unbind variable Spacing' }));
    expect(onUnbind).toHaveBeenCalledTimes(1);
  });

  it('leaves Home and End to native caret movement (APG spinbutton clarification)', () => {
    let val = 50;
    render(<NumberField label="X" value={val} min={0} max={100} onChange={(v) => (val = v)} />);
    const input = screen.getByLabelText('X');
    // Not default-prevented: the browser still moves the caret to line start/end.
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(val).toBe(50);
    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true);
    expect(val).toBe(50);
  });

  it('steps by at least ten base steps on PageUp/PageDown', () => {
    render(<Holder label="X" initial={0} min={0} max={100} />);
    const input = screen.getByLabelText('X') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'PageUp' });
    expect(input.value).toBe('10');
    fireEvent.keyDown(input, { key: 'PageDown' });
    expect(input.value).toBe('0');
    fireEvent.keyDown(input, { key: 'PageUp' });
    fireEvent.keyDown(input, { key: 'PageUp' });
    expect(input.value).toBe('20');
  });

  it('rebases the scrub accumulator when a modifier is pressed mid-drag', () => {
    let val = 0;
    render(<NumberField label="X" value={0} onChange={(v) => (val = v)} />);
    fireEvent.pointerDown(screen.getByText('X'), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 20 }); // +20 at x1
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
    fireEvent.pointerMove(window, { clientX: 30 }); // +10 at x10
    fireEvent.pointerUp(window);
    fireEvent.keyUp(window, { key: 'Shift' });
    // Pre-fix this was 30 x 10 = 300; travel before the modifier keeps its factor.
    expect(val).toBe(120);
  });

  it('does not quantize a fine-step scrub to a 0.01 grid', () => {
    let val = 0;
    render(<NumberField label="X" value={0.12345} step={0.001} onChange={(v) => (val = v)} />);
    fireEvent.pointerDown(screen.getByText('X'), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 10 });
    expect(val).toBeCloseTo(0.13345, 6);
  });

  it('steps from a valid draft instead of the stale model value', () => {
    render(<Holder label="X" initial={10} />);
    const input = screen.getByLabelText('X') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('201');
  });

  it('leaves an invalid draft alone when stepping', () => {
    render(<Holder label="X" initial={10} />);
    const input = screen.getByLabelText('X') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('abc');
  });

  it('does not change the value on wheel when the field is not focused', () => {
    const onChange = vi.fn();
    render(<NumberField label="X" value={10} onChange={onChange} />);
    fireEvent.wheel(screen.getByLabelText('X'), { deltaY: -1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens no transaction when stepping cannot change the value', () => {
    vi.useFakeTimers();
    try {
      const beginTransaction = vi.fn();
      const commitTransaction = vi.fn();
      const value = {
        beginTransaction,
        commitTransaction,
        abortTransaction: vi.fn(),
      } as unknown as EditorContextValue;
      render(
        <EditorCtx.Provider value={value}>
          <Holder label="X" initial={100} min={0} max={100} />
        </EditorCtx.Provider>,
      );
      const input = screen.getByLabelText('X') as HTMLInputElement;
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      fireEvent.keyUp(window, { key: 'ArrowUp' });
      input.focus();
      fireEvent.wheel(input, { deltaY: -1 });
      fireEvent.blur(input);
      vi.advanceTimersByTime(250);
      expect(beginTransaction).not.toHaveBeenCalled();
      expect(commitTransaction).not.toHaveBeenCalled();
      expect(input.value).toBe('100');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens no transaction when a scrub is clamped at its bound', () => {
    const beginTransaction = vi.fn();
    const commitTransaction = vi.fn();
    const value = {
      beginTransaction,
      commitTransaction,
      abortTransaction: vi.fn(),
    } as unknown as EditorContextValue;
    render(
      <EditorCtx.Provider value={value}>
        <Holder label="X" initial={100} min={0} max={100} />
      </EditorCtx.Provider>,
    );
    fireEvent.pointerDown(screen.getByText('X'), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 40 });
    fireEvent.pointerUp(window);
    expect(beginTransaction).not.toHaveBeenCalled();
    expect(commitTransaction).not.toHaveBeenCalled();
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('100');
  });

  it('cancels a scrub on Escape and restores the starting value', () => {
    const abortTransaction = vi.fn();
    const commitTransaction = vi.fn();
    const value = {
      beginTransaction: vi.fn(),
      commitTransaction,
      abortTransaction,
    } as unknown as EditorContextValue;
    function ScrubHolder() {
      const [current, setCurrent] = useState(10);
      return <NumberField label="X" value={current} onChange={setCurrent} />;
    }
    render(
      <EditorCtx.Provider value={value}>
        <ScrubHolder />
      </EditorCtx.Provider>,
    );
    fireEvent.pointerDown(screen.getByText('X'), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 30 });
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('40');
    fireEvent.keyDown(window, { key: 'Escape' });
    // The store restores the document on abort (E2E asserts the rendered
    // value); here the mocked context only proves the cancel was signalled.
    expect(abortTransaction).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window);
    expect(commitTransaction).not.toHaveBeenCalled();
  });

  it('ignores pointer events from a different pointer id', () => {
    const onChange = vi.fn();
    render(<NumberField label="X" value={10} onChange={onChange} />);
    fireEvent.pointerDown(screen.getByText('X'), { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 30, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(onChange).not.toHaveBeenCalled();
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

  it('lets a mixed field replace the state label with the first typed value', () => {
    let val = 10;
    render(<NumberField label="X" value={0} mixed onChange={(v) => (val = v)} />);
    const input = screen.getByLabelText('X') as HTMLInputElement;
    expect(input.value).toBe('Mixed');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(val).toBe(42);
  });

  it('cancels a draft when its target scope changes', () => {
    const view = render(<NumberField label="X" value={10} draftKey="doc:a" onChange={() => {}} />);
    const input = screen.getByLabelText('X') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '42' } });
    expect(input.value).toBe('42');
    view.rerender(<NumberField label="X" value={20} draftKey="doc:b" onChange={() => {}} />);
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('20');
  });

  it('aborts a label scrub when the pointer is cancelled', () => {
    const beginTransaction = vi.fn();
    const commitTransaction = vi.fn();
    const abortTransaction = vi.fn();
    const onChange = vi.fn();
    const value = {
      beginTransaction,
      commitTransaction,
      abortTransaction,
    } as unknown as EditorContextValue;
    render(
      <EditorCtx.Provider value={value}>
        <NumberField label="X" value={10} onChange={onChange} />
      </EditorCtx.Provider>,
    );
    fireEvent.pointerDown(screen.getByText('X'), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 12 });
    fireEvent.pointerCancel(window);
    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(abortTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction).not.toHaveBeenCalled();
  });

  it('keeps a scrub transaction open across preview rerenders and commits once', () => {
    const beginTransaction = vi.fn();
    const commitTransaction = vi.fn();
    const abortTransaction = vi.fn();
    const value = {
      beginTransaction,
      commitTransaction,
      abortTransaction,
    } as unknown as EditorContextValue;
    function ScrubHolder() {
      const [current, setCurrent] = useState(10);
      return <NumberField label="X" value={current} onChange={setCurrent} />;
    }
    render(
      <EditorCtx.Provider value={value}>
        <ScrubHolder />
      </EditorCtx.Provider>,
    );
    fireEvent.pointerDown(screen.getByText('X'), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 12 });
    fireEvent.pointerUp(window);
    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction).toHaveBeenCalledTimes(1);
    expect(abortTransaction).not.toHaveBeenCalled();
  });
});

describe('NumberField relative edits (onDelta)', () => {
  it('scrubs through onDelta with increments while typing still commits absolute values', () => {
    const onChange = vi.fn();
    const onDelta = vi.fn();
    render(<NumberField label="X" value={0} mixed onChange={onChange} onDelta={onDelta} />);
    fireEvent.pointerDown(screen.getByText('X'), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 10 });
    fireEvent.pointerMove(window, { clientX: 30 });
    fireEvent.pointerUp(window);
    expect(onDelta.mock.calls.map(([delta]) => delta)).toEqual([10, 20]);
    expect(onChange).not.toHaveBeenCalled();

    const input = screen.getByLabelText('X') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it('steps through onDelta on arrow and page keys', () => {
    const onDelta = vi.fn();
    render(<NumberField label="X" value={0} onChange={() => {}} onDelta={onDelta} />);
    const input = screen.getByLabelText('X');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyUp(window, { key: 'ArrowUp' });
    expect(onDelta).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyUp(window, { key: 'ArrowDown' });
    expect(onDelta).toHaveBeenLastCalledWith(-10);
    fireEvent.keyDown(input, { key: 'PageUp' });
    fireEvent.keyUp(window, { key: 'PageUp' });
    expect(onDelta).toHaveBeenLastCalledWith(10);
  });

  it('exposes a text keyboard so signed values and expressions are typeable', () => {
    render(<NumberField label="X" value={-40} min={-100} onChange={() => {}} />);
    expect(screen.getByLabelText('X').getAttribute('inputmode')).toBe('text');
  });
});

describe('stripFloatResidue', () => {
  it('removes binary residue without imposing a decimal grid', () => {
    expect(stripFloatResidue(270.40000000000003)).toBe(270.4);
    expect(stripFloatResidue(0.1 + 0.2)).toBe(0.3);
    expect(stripFloatResidue(Number('0.13345000000000002'))).toBeCloseTo(0.13345, 9);
    expect(Object.is(stripFloatResidue(-0), 0)).toBe(true);
    expect(stripFloatResidue(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});
