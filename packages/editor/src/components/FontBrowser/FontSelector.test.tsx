import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontSelector } from './FontSelector';

afterEach(cleanup);

describe('FontSelector', () => {
  it('keeps combobox and listbox relationships unique when mounted twice', async () => {
    render(
      <>
        <FontSelector value="Inter" onChange={() => {}} />
        <FontSelector value="Georgia" onChange={() => {}} />
      </>,
    );

    const inputs = screen.getAllByRole('combobox');
    expect(inputs).toHaveLength(2);
    const inputIds = inputs.map((input) => input.id);
    const controls = inputs.map((input) => input.getAttribute('aria-controls'));
    expect(new Set(inputIds).size).toBe(2);
    expect(new Set(controls).size).toBe(2);
    for (const id of controls) {
      expect(id).toBeTruthy();
    }
    fireEvent.focus(inputs[0]!);
    await screen.findByRole('listbox', { name: 'Font families' });
    expect(document.getElementById(controls[0]!)).toHaveAttribute('role', 'listbox');
    fireEvent.blur(inputs[0]!);
    fireEvent.focus(inputs[1]!);
    await screen.findAllByRole('listbox', { name: 'Font families' });
    expect(document.getElementById(controls[1]!)).toHaveAttribute('role', 'listbox');
  });

  it('leaves Home and End available for editing the query', () => {
    render(<FontSelector value="Inter" onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true);
  });

  it('dismisses the open picker without bubbling Escape to the toolbar', async () => {
    const onDocumentKeyDown = vi.fn();
    document.addEventListener('keydown', onDocumentKeyDown);
    render(<FontSelector value="Inter" onChange={() => {}} />);

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(await screen.findByRole('listbox', { name: 'Font families' })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: 'Font families' })).not.toBeInTheDocument();
    expect(onDocumentKeyDown).not.toHaveBeenCalled();
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDocumentKeyDown).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', onDocumentKeyDown);
  });
});
