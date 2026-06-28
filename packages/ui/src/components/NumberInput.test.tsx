import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NumberInput } from './NumberInput';

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
});
