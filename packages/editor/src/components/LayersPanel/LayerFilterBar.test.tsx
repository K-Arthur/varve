import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayerFilterBar } from './LayerFilterBar';
import { DEFAULT_FILTER, type LayerFilterSpec } from './layerFilterTypes';

describe('LayerFilterBar — chip semantics', () => {
  it('exposes filter chips as toggle buttons, not listbox options', () => {
    render(
      <LayerFilterBar filter={DEFAULT_FILTER} onChange={vi.fn()} matchCount={3} totalCount={12} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show filter options' }));

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Locked' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('labels the inverted attribute state instead of rendering an empty chip', () => {
    let filter: LayerFilterSpec = DEFAULT_FILTER;
    const onChange = vi.fn((next: LayerFilterSpec) => {
      filter = next;
    });
    const { rerender } = render(
      <LayerFilterBar filter={filter} onChange={onChange} matchCount={3} totalCount={12} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show filter options' }));

    // First click: require locked. Second click: require unlocked.
    fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
    rerender(<LayerFilterBar filter={filter} onChange={onChange} matchCount={3} totalCount={12} />);
    expect(filter.attributes.locked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
    rerender(<LayerFilterBar filter={filter} onChange={onChange} matchCount={1} totalCount={12} />);
    expect(filter.attributes.locked).toBe(false);

    expect(screen.getByRole('button', { name: 'Unlocked' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Attribute chips are text chips; an icon-only button elsewhere in the
    // bar (color swatches) is expected to be nameless in textContent only.
    for (const chip of document.querySelectorAll('.layers-filter-bar__chip')) {
      expect((chip.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('cycles Locked -> Locked -> Unlocked -> Locked through its states', () => {
    let filter: LayerFilterSpec = DEFAULT_FILTER;
    const onChange = vi.fn((next: LayerFilterSpec) => {
      filter = next;
    });
    const { rerender } = render(
      <LayerFilterBar filter={filter} onChange={onChange} matchCount={3} totalCount={12} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show filter options' }));

    const rerenderBar = () =>
      rerender(
        <LayerFilterBar filter={filter} onChange={onChange} matchCount={3} totalCount={12} />,
      );

    fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
    rerenderBar();
    expect(filter.attributes.locked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
    rerenderBar();
    expect(filter.attributes.locked).toBe(false);
    expect(screen.getByRole('button', { name: 'Unlocked' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Unlocked' }));
    rerenderBar();
    expect(filter.attributes.locked).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Locked' })).toHaveAttribute('aria-pressed', 'false');
  });
});
