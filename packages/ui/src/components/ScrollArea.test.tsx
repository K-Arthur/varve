import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { ScrollArea, ScrollProgress } from './ScrollArea';

describe('ScrollArea', () => {
  it('exposes the real viewport through viewportRef', () => {
    const viewportRef = createRef<HTMLDivElement>();
    render(
      <ScrollArea orientation="horizontal" viewportRef={viewportRef}>
        <span>content</span>
      </ScrollArea>,
    );

    expect(screen.getByText('content').parentElement).toBe(viewportRef.current);
    expect(viewportRef.current).toHaveAttribute('data-slot', 'scroll-area-viewport');
    expect(viewportRef.current?.parentElement).toHaveAttribute('data-orientation', 'horizontal');
  });

  it('keeps keyboard focus opt-in on the viewport', () => {
    render(
      <ScrollArea viewportProps={{ tabIndex: 0, 'aria-label': 'Layer list' }}>
        <span>layers</span>
      </ScrollArea>,
    );

    expect(screen.getByLabelText('Layer list')).toHaveAttribute('tabindex', '0');
  });

  it('provides an optional progress composition without changing the viewport tree', () => {
    const viewportRef = createRef<HTMLDivElement>();
    render(
      <>
        <ScrollArea viewportRef={viewportRef}>
          <span>content</span>
        </ScrollArea>
        <ScrollProgress viewportRef={viewportRef} aria-label="Reading progress" />
      </>,
    );

    expect(screen.getByRole('progressbar', { name: 'Reading progress' })).toBeInTheDocument();
  });
});
