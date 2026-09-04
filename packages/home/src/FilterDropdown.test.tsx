/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileKind } from '@varve/platform';
import { describe, expect, it, vi } from 'vitest';
import { FilterDropdown } from './FilterDropdown';

describe('FilterDropdown', () => {
  const defaultProps = {
    kinds: [] as FileKind[],
    pinnedOnly: false,
    dateFrom: null as number | null,
    dateTo: null as number | null,
    onKindsChange: vi.fn(),
    onPinnedOnlyChange: vi.fn(),
    onDateFromChange: vi.fn(),
    onDateToChange: vi.fn(),
    onClear: vi.fn(),
  };

  async function openFilters() {
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const filterDialog = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('.filter-dropdown');
      if (!element) {
        throw new Error('Filter popover did not open');
      }
      return element;
    });
    return within(filterDialog);
  }

  it('renders filter trigger button', () => {
    const { container } = render(<FilterDropdown {...defaultProps} />);
    const btn = container.querySelector('button');
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toContain('Filters');
  });

  it('shows active filter count badge when filters applied', () => {
    const { container } = render(<FilterDropdown {...defaultProps} kinds={['image']} />);
    const badge = container.querySelector('.filter-dropdown__badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('1');
  });

  it('shows count of multiple active filters', () => {
    const { container } = render(
      <FilterDropdown {...defaultProps} kinds={['image']} pinnedOnly={true} />,
    );
    const badge = container.querySelector('.filter-dropdown__badge');
    expect(badge?.textContent).toBe('2');
  });

  it('shows no badge when no filters active', () => {
    const { container } = render(<FilterDropdown {...defaultProps} />);
    const badge = container.querySelector('.filter-dropdown__badge');
    expect(badge).toBeFalsy();
  });

  it('renders kind checkboxes', async () => {
    render(<FilterDropdown {...defaultProps} />);
    const filters = await openFilters();
    const kindSection = filters.getByText('File type').parentElement;
    expect(kindSection).toBeTruthy();
    const labels = kindSection?.querySelectorAll('.filter-dropdown__checkbox-label');
    expect(labels?.length).toBe(5); // strata, figma, illustrator, image, unknown
  });

  it('calls onKindsChange when kind checkbox toggled', async () => {
    const onKindsChange = vi.fn();
    render(<FilterDropdown {...defaultProps} onKindsChange={onKindsChange} />);
    const filters = await openFilters();
    const kindSection = filters.getByText('File type').parentElement;
    expect(kindSection).toBeTruthy();
    const checkboxes = kindSection!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThan(0);
    fireEvent.click(checkboxes[1]!);
    expect(onKindsChange).toHaveBeenCalledWith(['figma']);
  });

  it('calls onPinnedOnlyChange when pinned toggle clicked', async () => {
    const onPinnedOnlyChange = vi.fn();
    render(<FilterDropdown {...defaultProps} onPinnedOnlyChange={onPinnedOnlyChange} />);
    const filters = await openFilters();
    const toggle = filters.getByLabelText('Pinned only');
    fireEvent.click(toggle);
    expect(onPinnedOnlyChange).toHaveBeenCalledWith(true);
  });

  it('calls onClear when clear button clicked', async () => {
    const onClear = vi.fn();
    render(<FilterDropdown {...defaultProps} kinds={['image']} onClear={onClear} />);
    const filters = await openFilters();
    const clearButton = filters.getByText('Clear all').closest('button');
    expect(clearButton).toBeTruthy();
    fireEvent.click(clearButton!);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders date from/to inputs', async () => {
    render(<FilterDropdown {...defaultProps} />);
    const filters = await openFilters();
    expect(filters.getByText('Date modified')).toBeTruthy();
    expect(filters.getByLabelText('From')).toHaveAttribute('type', 'date');
    expect(filters.getByLabelText('To')).toHaveAttribute('type', 'date');
  });

  it('shows pinned toggle unchecked by default', async () => {
    render(<FilterDropdown {...defaultProps} />);
    const filters = await openFilters();
    expect(filters.getByLabelText('Pinned only')).not.toBeChecked();
  });

  it('shows pinned toggle checked when pinnedOnly is true', async () => {
    render(<FilterDropdown {...defaultProps} pinnedOnly={true} />);
    const filters = await openFilters();
    expect(filters.getByLabelText('Pinned only')).toBeChecked();
  });
});
