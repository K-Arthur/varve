/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HighlightMatch, SearchField } from './SearchField';

describe('SearchField', () => {
  it('renders with value', () => {
    const { container } = render(<SearchField value="hello" onChange={vi.fn()} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('hello');
  });

  it('calls onChange when typed into', () => {
    const onChange = vi.fn();
    const { container } = render(<SearchField value="" onChange={onChange} />);
    const input = container.querySelector('input');
    if (!input) throw new Error('input not found');
    fireEvent.change(input, { target: { value: 'test' } });
    expect(onChange).toHaveBeenCalledWith('test');
  });

  it('clears when clear button clicked', () => {
    const onChange = vi.fn();
    const { container } = render(<SearchField value="query" onChange={onChange} />);
    const clearBtn = container.querySelector('.varve-search__clear') as HTMLButtonElement;
    expect(clearBtn).toBeDefined();
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('announces result count', () => {
    const { container } = render(<SearchField value="a" onChange={vi.fn()} resultCount={5} />);
    expect(container.textContent).toContain('5 results');
  });

  // Regression: the input relied on its placeholder for naming. A placeholder
  // is not a dependable accessible name and disappears once the user types, so
  // callers that passed only a placeholder shipped an unnamed search field.
  describe('accessible name', () => {
    it('falls back to the placeholder text as an explicit label', () => {
      const { container } = render(
        <SearchField value="" onChange={vi.fn()} placeholder="Search files…" />,
      );
      const input = container.querySelector('input') as HTMLInputElement;
      expect(input).toHaveAttribute('aria-label', 'Search files…');
    });

    it('keeps the name after text is entered', () => {
      const { container } = render(
        <SearchField value="report" onChange={vi.fn()} placeholder="Search files…" />,
      );
      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('report');
      expect(input).toHaveAttribute('aria-label', 'Search files…');
    });

    it('does not override a caller-supplied aria-label', () => {
      const { container } = render(
        <SearchField
          value=""
          onChange={vi.fn()}
          placeholder="Search files…"
          aria-label="Search assets"
        />,
      );
      const input = container.querySelector('input') as HTMLInputElement;
      expect(input).toHaveAttribute('aria-label', 'Search assets');
    });

    it('does not add aria-label when labelled by another element', () => {
      const { container } = render(
        <>
          <span id="search-label">Find</span>
          <SearchField value="" onChange={vi.fn()} aria-labelledby="search-label" />
        </>,
      );
      const input = container.querySelector('input') as HTMLInputElement;
      expect(input).not.toHaveAttribute('aria-label');
      expect(input).toHaveAttribute('aria-labelledby', 'search-label');
    });
  });
});

describe('HighlightMatch', () => {
  it('renders plain text when no query', () => {
    const { container } = render(<HighlightMatch text="hello" query="" />);
    expect(container.textContent).toBe('hello');
  });

  it('wraps matched substring in <mark>', () => {
    const { container } = render(<HighlightMatch text="hello world" query="world" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('world');
  });

  it('is case-insensitive', () => {
    const { container } = render(<HighlightMatch text="Hello World" query="hello" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
  });
});
