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
    const clearBtn = container.querySelector('.strata-search__clear') as HTMLButtonElement;
    expect(clearBtn).toBeDefined();
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('announces result count', () => {
    const { container } = render(<SearchField value="a" onChange={vi.fn()} resultCount={5} />);
    expect(container.textContent).toContain('5 results');
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
