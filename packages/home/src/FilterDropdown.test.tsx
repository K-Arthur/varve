/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react';
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

  it('renders kind checkboxes', () => {
    const { container } = render(<FilterDropdown {...defaultProps} />);
    const kindSection = container.querySelector('.filter-dropdown__section-kinds');
    expect(kindSection).toBeTruthy();
    const labels = kindSection?.querySelectorAll('.filter-dropdown__checkbox-label');
    expect(labels?.length).toBe(5); // strata, figma, illustrator, image, unknown
  });

  it('calls onKindsChange when kind checkbox toggled', () => {
    const onKindsChange = vi.fn();
    const { container } = render(
      <FilterDropdown {...defaultProps} onKindsChange={onKindsChange} />,
    );
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
      '.filter-dropdown__section-kinds input[type="checkbox"]',
    );
    expect(checkboxes.length).toBeGreaterThan(0);
    fireEvent.click(checkboxes[1]!);
    expect(onKindsChange).toHaveBeenCalledWith(['figma']);
  });

  it('calls onPinnedOnlyChange when pinned toggle clicked', () => {
    const onPinnedOnlyChange = vi.fn();
    const { container } = render(
      <FilterDropdown {...defaultProps} onPinnedOnlyChange={onPinnedOnlyChange} />,
    );
    const toggle = container.querySelector('.filter-dropdown__pinned-toggle input');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);
    expect(onPinnedOnlyChange).toHaveBeenCalledWith(true);
  });

  it('calls onClear when clear button clicked', () => {
    const onClear = vi.fn();
    const { container } = render(
      <FilterDropdown {...defaultProps} kinds={['image']} onClear={onClear} />,
    );
    const clearBtn = container.querySelector('.filter-dropdown__clear');
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn!);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders date from/tp inputs', () => {
    const { container } = render(<FilterDropdown {...defaultProps} />);
    const dateSection = container.querySelector('.filter-dropdown__section-date');
    expect(dateSection).toBeTruthy();
  });

  it('shows pinned toggle unchecked by default', () => {
    const { container } = render(<FilterDropdown {...defaultProps} />);
    const toggle = container.querySelector<HTMLInputElement>(
      '.filter-dropdown__pinned-toggle input',
    );
    expect(toggle?.checked).toBe(false);
  });

  it('shows pinned toggle checked when pinnedOnly is true', () => {
    const { container } = render(<FilterDropdown {...defaultProps} pinnedOnly={true} />);
    const toggle = container.querySelector<HTMLInputElement>(
      '.filter-dropdown__pinned-toggle input',
    );
    expect(toggle?.checked).toBe(true);
  });
});
