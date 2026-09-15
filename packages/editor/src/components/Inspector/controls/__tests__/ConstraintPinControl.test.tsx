import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConstraintPinControl } from '../ConstraintPinControl';

afterEach(cleanup);

describe('ConstraintPinControl', () => {
  it('renders with role="group" and accessible label', () => {
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={() => {}} />);
    expect(screen.getByRole('group', { name: /visual constraint editor/i })).toBeTruthy();
  });

  it('renders all 8 interactive zone buttons', () => {
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /pin left edge/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /pin right edge/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /stretch horizontally/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /pin top edge/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /pin bottom edge/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /stretch vertically/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /center both axes/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /scale proportionally/i })).toBeTruthy();
  });

  it('clicking left zone sets horizontal to min', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="stretch" vertical="min" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /pin left edge/i }));
    expect(onChange).toHaveBeenCalledWith('min', 'min');
  });

  it('clicking right zone sets horizontal to max', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /pin right edge/i }));
    expect(onChange).toHaveBeenCalledWith('max', 'min');
  });

  it('clicking stretch-h zone sets horizontal to stretch', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /stretch horizontally/i }));
    expect(onChange).toHaveBeenCalledWith('stretch', 'min');
  });

  it('clicking top zone sets vertical to min', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="stretch" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /pin top edge/i }));
    expect(onChange).toHaveBeenCalledWith('min', 'min');
  });

  it('clicking bottom zone sets vertical to max', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /pin bottom edge/i }));
    expect(onChange).toHaveBeenCalledWith('min', 'max');
  });

  it('clicking stretch-v zone sets vertical to stretch', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /stretch vertically/i }));
    expect(onChange).toHaveBeenCalledWith('min', 'stretch');
  });

  it('clicking center zone sets both axes to center', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /center both axes/i }));
    expect(onChange).toHaveBeenCalledWith('center', 'center');
  });

  it('clicking scale zone sets both axes to scale', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /scale proportionally/i }));
    expect(onChange).toHaveBeenCalledWith('scale', 'scale');
  });

  it('does not call onChange when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={onChange} disabled />);
    await user.click(screen.getByRole('button', { name: /pin left edge/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyboard Enter activates focused zone', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={onChange} />);
    const leftBtn = screen.getByRole('button', { name: /pin left edge/i });
    leftBtn.focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('min', 'min');
  });

  it('keyboard Space activates focused zone', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={onChange} />);
    const centerBtn = screen.getByRole('button', { name: /center both axes/i });
    centerBtn.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('center', 'center');
  });

  it('keyboard arrows navigate between zones', async () => {
    const user = userEvent.setup();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={() => {}} />);
    const leftBtn = screen.getByRole('button', { name: /pin left edge/i });
    leftBtn.focus();
    await user.keyboard('{ArrowRight}');
    // After ArrowRight, focus should move to the next zone (right)
    const rightBtn = screen.getByRole('button', { name: /pin right edge/i });
    expect(document.activeElement).toBe(rightBtn);
  });

  it('keyboard Home navigates to center zone', async () => {
    const user = userEvent.setup();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={() => {}} />);
    const leftBtn = screen.getByRole('button', { name: /pin left edge/i });
    leftBtn.focus();
    await user.keyboard('{Home}');
    const centerBtn = screen.getByRole('button', { name: /center both axes/i });
    expect(document.activeElement).toBe(centerBtn);
  });

  it('keyboard End navigates to scale zone', async () => {
    const user = userEvent.setup();
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={() => {}} />);
    const leftBtn = screen.getByRole('button', { name: /pin left edge/i });
    leftBtn.focus();
    await user.keyboard('{End}');
    const scaleBtn = screen.getByRole('button', { name: /scale proportionally/i });
    expect(document.activeElement).toBe(scaleBtn);
  });

  it('renders SVG with parent frame, child rect, and constraint lines', () => {
    render(<ConstraintPinControl horizontal="min" vertical="min" onChange={() => {}} />);
    const svg = document.querySelector('.constraint-pin-control__svg');
    expect(svg).toBeTruthy();
    const parent = svg?.querySelector('.constraint-pin-control__parent');
    expect(parent).toBeTruthy();
    const child = svg?.querySelector('.constraint-pin-control__child');
    expect(child).toBeTruthy();
  });
});
