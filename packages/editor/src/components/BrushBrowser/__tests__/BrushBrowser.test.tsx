// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { defaultBrushPreset } from '@varve/scene';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BrushBrowser, type BrushBrowserItem } from '../BrushBrowser';

function customItem(id: string, name: string, category = 'custom'): BrushBrowserItem {
  return {
    id,
    name,
    category,
    tags: ['mine'],
    preset: defaultBrushPreset(id, name),
    isBuiltIn: false,
  };
}

function renderBrowser(overrides: Partial<ComponentProps<typeof BrushBrowser>> = {}) {
  const props = {
    customItems: [customItem('c1', 'Charcoal Stick'), customItem('c2', 'Wet Wash')],
    selectedId: 'built-in-round',
    favoriteIds: new Set<string>(),
    recentIds: [] as string[],
    onSelect: vi.fn(),
    onToggleFavorite: vi.fn(),
    ...overrides,
  };
  render(<BrushBrowser {...props} />);
  return props;
}

describe('BrushBrowser', () => {
  it('lists built-in and custom brushes together', () => {
    renderBrowser();
    expect(screen.getByRole('button', { name: 'Round' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Charcoal Stick' })).toBeTruthy();
  });

  it('exposes every brush as a named button, not just an image', () => {
    renderBrowser();
    const list = screen.getByRole('list', { name: 'Brushes' });
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(2);
    expect(screen.getByRole('button', { name: 'Charcoal Stick' })).toBeTruthy();
  });

  it('marks the selected brush for assistive technology', () => {
    renderBrowser({ selectedId: 'c1' });
    expect(
      screen.getByRole('button', { name: 'Charcoal Stick' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('filters by search across name and tags', () => {
    renderBrowser();
    fireEvent.change(screen.getByLabelText('Search brushes'), { target: { value: 'charcoal' } });
    expect(screen.getByRole('button', { name: 'Charcoal Stick' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wet Wash' })).toBeNull();
  });

  it('shows an empty state rather than a blank grid', () => {
    renderBrowser();
    fireEvent.change(screen.getByLabelText('Search brushes'), { target: { value: 'zzzz' } });
    expect(screen.queryByRole('list', { name: 'Brushes' })).toBeNull();
    expect(screen.getByText(/No brushes match/)).toBeTruthy();
  });

  it('filters to favourites', () => {
    renderBrowser({ favoriteIds: new Set(['c1']) });
    fireEvent.click(screen.getByRole('tab', { name: 'Favorites' }));
    expect(screen.getByRole('button', { name: 'Charcoal Stick' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wet Wash' })).toBeNull();
  });

  it('orders the recent filter by recency', () => {
    renderBrowser({ recentIds: ['c2', 'c1'] });
    fireEvent.click(screen.getByRole('tab', { name: 'Recent' }));
    const names = screen.getAllByRole('listitem').map((o) => o.textContent);
    expect(names[0]).toContain('Wet Wash');
    expect(names[1]).toContain('Charcoal Stick');
  });

  it('selects a brush on click', () => {
    const props = renderBrowser();
    fireEvent.click(screen.getByRole('button', { name: 'Charcoal Stick' }));
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('toggles a favourite with an announced, pressed control', () => {
    const props = renderBrowser({ favoriteIds: new Set(['c1']) });
    const button = screen.getByRole('button', { name: 'Unfavorite Charcoal Stick' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(props.onToggleFavorite).toHaveBeenCalledWith('c1');
  });

  it('offers delete only for brushes the user owns', () => {
    renderBrowser({ onDelete: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Delete Round' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete Charcoal Stick' })).toBeTruthy();
  });

  it('says editing a built-in makes a copy', () => {
    renderBrowser({ onEdit: vi.fn() });
    expect(screen.getByRole('button', { name: 'Edit a copy of Round' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Charcoal Stick' })).toBeTruthy();
  });
});
