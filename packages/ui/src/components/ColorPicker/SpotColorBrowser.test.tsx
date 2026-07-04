// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpotColorBrowser } from './SpotColorBrowser';

afterEach(cleanup);

describe('SpotColorBrowser', () => {
  it('renders search input', () => {
    render(<SpotColorBrowser onSelect={() => {}} />);
    expect(screen.getByRole('textbox', { name: /search/i })).toBeTruthy();
  });

  it('renders spot color options', () => {
    render(<SpotColorBrowser onSelect={() => {}} />);
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveAttribute('aria-label');
  });

  it('filters results on search', () => {
    render(<SpotColorBrowser onSelect={() => {}} />);
    const searchInput = screen.getByRole('textbox', { name: /search/i });
    act(() => {
      (searchInput as HTMLInputElement).value = 'PANTONE 185';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
  });

  it('calls onSelect when an option is clicked', () => {
    const onSelect = vi.fn();
    render(<SpotColorBrowser onSelect={onSelect} />);
    const firstOption = screen.getAllByRole('option')[0];
    if (firstOption) firstOption.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selected = onSelect.mock.calls[0]?.[0] as { space: string } | undefined;
    expect(selected?.space).toBe('spot');
  });
});
