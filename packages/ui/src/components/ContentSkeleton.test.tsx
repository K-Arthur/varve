import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentSkeleton } from './ContentSkeleton';

describe('ContentSkeleton', () => {
  it('renders with accessibility label', () => {
    render(<ContentSkeleton label="Loading layers" />);
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByLabelText('Loading layers')).toBeDefined();
  });

  it('renders the correct number of rows in list variant', () => {
    const { container } = render(<ContentSkeleton rows={3} label="test" />);
    const items = container.querySelectorAll('.content-skeleton__row');
    expect(items).toHaveLength(3);
  });

  it('renders grid variant with correct cell count', () => {
    const { container } = render(
      <ContentSkeleton variant="grid" columns={4} rows={2} label="grid" />,
    );
    const items = container.querySelectorAll('.content-skeleton__cell');
    expect(items).toHaveLength(8);
  });

  it('renders card variant with icon, title, description', () => {
    const { container } = render(<ContentSkeleton variant="card" label="card" />);
    expect(container.querySelector('.content-skeleton__card-icon')).toBeDefined();
    expect(container.querySelector('.content-skeleton__card-title')).toBeDefined();
    expect(container.querySelector('.content-skeleton__card-desc')).toBeDefined();
  });

  it('renders inline variant with correct width', () => {
    const { container } = render(<ContentSkeleton variant="inline" width="60%" label="inline" />);
    const el = container.querySelector('.content-skeleton--inline');
    expect(el).toBeDefined();
    expect(el?.getAttribute('style')).toContain('width: 60%');
  });
});
