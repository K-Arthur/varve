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

describe('LayerFilterBar — workspace presets', () => {
  it('renders only the configured quick filters, as toggle buttons', () => {
    render(
      <LayerFilterBar
        filter={DEFAULT_FILTER}
        onChange={vi.fn()}
        matchCount={3}
        totalCount={12}
        quickFilters={['animated']}
      />,
    );

    const preset = screen.getByRole('button', { name: 'Animated' });
    expect(preset).toHaveAttribute('aria-pressed', 'false');
    // No other workspace preset leaks in.
    expect(screen.queryByRole('button', { name: 'Mobile hidden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Threaded text' })).toBeNull();
  });

  it('maps each preset onto its attribute dimension and back off', () => {
    let filter: LayerFilterSpec = DEFAULT_FILTER;
    const onChange = vi.fn((next: LayerFilterSpec) => {
      filter = next;
    });
    const { rerender } = render(
      <LayerFilterBar
        filter={filter}
        onChange={onChange}
        matchCount={3}
        totalCount={12}
        quickFilters={['mobile-hidden', 'masks']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mobile hidden' }));
    expect(filter.attributes.mobileHidden).toBe(true);
    rerender(
      <LayerFilterBar
        filter={filter}
        onChange={onChange}
        matchCount={3}
        totalCount={12}
        quickFilters={['mobile-hidden', 'masks']}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mobile hidden' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mobile hidden' }));
    expect(filter.attributes.mobileHidden).toBeUndefined();
  });

  it('offers Select matches only while filtering with at least one match', () => {
    const onSelectMatches = vi.fn();
    const { rerender } = render(
      <LayerFilterBar
        filter={DEFAULT_FILTER}
        onChange={vi.fn()}
        matchCount={12}
        totalCount={12}
        onSelectMatches={onSelectMatches}
      />,
    );
    // No filter: nothing to select "matches" of.
    expect(screen.queryByRole('button', { name: 'Select matches' })).toBeNull();

    const filtered = { ...DEFAULT_FILTER, search: 'button' };
    rerender(
      <LayerFilterBar
        filter={filtered}
        onChange={vi.fn()}
        matchCount={4}
        totalCount={12}
        onSelectMatches={onSelectMatches}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select matches' }));
    expect(onSelectMatches).toHaveBeenCalledTimes(1);
  });

  it('has no Select matches action when the caller does not provide one', () => {
    render(
      <LayerFilterBar
        filter={{ ...DEFAULT_FILTER, search: 'x' }}
        onChange={vi.fn()}
        matchCount={1}
        totalCount={12}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Select matches' })).toBeNull();
  });
});
