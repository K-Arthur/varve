import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberInput, stripFloatResidue } from './NumberInput';

afterEach(cleanup);

describe('NumberInput', () => {
  it('renders value', () => {
    render(<NumberInput value={42} label="Test" onChange={() => {}} />);
    const input = screen.getByLabelText('Test') as HTMLInputElement;
    expect(input.value).toBe('42');
  });

  it('increments on ArrowUp', () => {
    let val = 50;
    render(
      <NumberInput
        value={val}
        label="Test"
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    const input = screen.getByLabelText('Test');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(val).toBe(51);
  });

  it('decrements on ArrowDown', () => {
    let val = 50;
    render(
      <NumberInput
        value={val}
        label="Test"
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    const input = screen.getByLabelText('Test');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(val).toBe(49);
  });

  it('increments by shiftStep with Shift', () => {
    let val = 50;
    render(
      <NumberInput
        value={val}
        shiftStep={10}
        label="Test"
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    const input = screen.getByLabelText('Test');
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    expect(val).toBe(60);
  });

  it('commits on blur', () => {
    let val = 100;
    render(
      <NumberInput
        value={val}
        label="Test"
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    const input = screen.getByLabelText('Test');
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.blur(input);
    expect(val).toBe(200);
  });

  it('clamps value to range', () => {
    let val = 50;
    render(
      <NumberInput
        value={val}
        min={0}
        max={100}
        label="Test"
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    const input = screen.getByLabelText('Test');
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(val).toBe(40);
  });

  it('rebases the scrub accumulator when a modifier is pressed mid-drag', () => {
    let val = 0;
    render(
      <NumberInput
        value={0}
        label="Test"
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    const input = screen.getByLabelText('Test');
    fireEvent.pointerDown(input, { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 20 });
    fireEvent.pointerMove(window, { clientX: 21, shiftKey: true });
    fireEvent.pointerMove(window, { clientX: 31, shiftKey: true });
    fireEvent.pointerUp(window);
    expect(val).toBe(120);
  });

  it('does not quantize a fine-step scrub to a 0.01 grid', () => {
    let val = 0;
    render(
      <NumberInput
        value={0.12345}
        step={0.001}
        label="Test"
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    const input = screen.getByLabelText('Test');
    fireEvent.pointerDown(input, { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 10 });
    expect(val).toBeCloseTo(0.13345, 6);
  });

  it('emits nothing when stepping or scrubbing cannot change the value', () => {
    const onChange = vi.fn();
    render(<NumberInput value={100} min={0} max={100} label="Test" onChange={onChange} />);
    const input = screen.getByLabelText('Test');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.pointerDown(input, { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 40 });
    fireEvent.pointerUp(window);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('restores the gesture-start value when a scrub is cancelled with Escape', () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} label="Test" onChange={onChange} />);
    const input = screen.getByLabelText('Test');
    fireEvent.pointerDown(input, { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 30 });
    expect(onChange).toHaveBeenLastCalledWith(40);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('ignores pointer events from a different pointer id', () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} label="Test" onChange={onChange} />);
    const input = screen.getByLabelText('Test');
    fireEvent.pointerDown(input, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 30, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('stripFloatResidue', () => {
  it('removes binary residue without imposing a decimal grid', () => {
    expect(stripFloatResidue(270.40000000000003)).toBe(270.4);
    expect(stripFloatResidue(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(stripFloatResidue(-0), 0)).toBe(true);
  });
});
