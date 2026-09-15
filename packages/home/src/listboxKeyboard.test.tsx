/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { handleListboxKeyDown } from './listboxKeyboard';

function Listbox({ onChoose = vi.fn() }: { onChoose?: (label: string) => void }) {
  const options = ['All Recent', 'Relevant to Workspace', 'Pinned Only'];
  return (
    <div role="listbox" aria-label="Workspace filter">
      {options.map((label, index) => (
        <button
          key={label}
          type="button"
          role="option"
          aria-selected={index === 0}
          tabIndex={index === 0 ? 0 : -1}
          onKeyDown={(event) => handleListboxKeyDown(event, () => onChoose(label))}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

describe('handleListboxKeyDown', () => {
  it('moves focus with ArrowDown/ArrowUp and wraps', () => {
    render(<Listbox />);
    const first = screen.getByRole('option', { name: 'All Recent' });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Relevant to Workspace' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Pinned Only' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: 'Pinned Only' })).toHaveFocus();
  });

  it('supports Home and End', () => {
    render(<Listbox />);
    const first = screen.getByRole('option', { name: 'All Recent' });
    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(screen.getByRole('option', { name: 'Pinned Only' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(first).toHaveFocus();
  });

  it('chooses with Enter and Space', () => {
    const onChoose = vi.fn();
    render(<Listbox onChoose={onChoose} />);
    const first = screen.getByRole('option', { name: 'All Recent' });
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith('All Recent');
    fireEvent.keyDown(first, { key: ' ' });
    expect(onChoose).toHaveBeenCalledTimes(2);
  });

  it('type-ahead focuses the matching option and refines by prefix', () => {
    render(<Listbox />);
    const first = screen.getByRole('option', { name: 'All Recent' });
    first.focus();
    fireEvent.keyDown(first, { key: 'r' });
    const relevant = screen.getByRole('option', { name: 'Relevant to Workspace' });
    expect(relevant).toHaveFocus();
    // Buffer accumulates inside the reset window, so the next letter refines
    // the same prefix instead of starting a new search.
    fireEvent.keyDown(relevant, { key: 'e' });
    expect(relevant).toHaveFocus();
  });

  it('type-ahead starts over for a different initial letter', () => {
    render(<Listbox />);
    const first = screen.getByRole('option', { name: 'All Recent' });
    first.focus();
    fireEvent.keyDown(first, { key: 'p' });
    expect(screen.getByRole('option', { name: 'Pinned Only' })).toHaveFocus();
  });

  it('does not intercept modified shortcuts or non-printable keys', () => {
    const onChoose = vi.fn();
    render(<Listbox onChoose={onChoose} />);
    const first = screen.getByRole('option', { name: 'All Recent' });
    first.focus();
    fireEvent.keyDown(first, { key: 'a', ctrlKey: true });
    expect(first).toHaveFocus();
    expect(onChoose).not.toHaveBeenCalled();
  });
});
