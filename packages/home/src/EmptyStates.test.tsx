/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyStates } from './EmptyStates';

describe('EmptyStates', () => {
  it('renders the correct headline for each section', () => {
    const { rerender } = render(<EmptyStates section="recent" onAction={vi.fn()} />);
    expect(screen.getByText('Nothing here yet')).toBeDefined();

    rerender(<EmptyStates section="all" onAction={vi.fn()} />);
    expect(screen.getByText('Start with a blank slate')).toBeDefined();

    rerender(<EmptyStates section="trash" onAction={vi.fn()} />);
    expect(screen.getByText('Trash is empty')).toBeDefined();

    rerender(<EmptyStates section="search" onAction={vi.fn()} />);
    expect(screen.getByText('No results found')).toBeDefined();
  });

  it('shows the query in search headline', () => {
    render(<EmptyStates section="search" query="foo" onAction={vi.fn()} />);
    expect(screen.getByText(/No results for/)).toBeDefined();
    expect(screen.getByText(/foo/)).toBeDefined();
  });
});
