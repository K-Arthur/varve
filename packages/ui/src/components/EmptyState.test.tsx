import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders headline', () => {
    render(<EmptyState illustration={<svg />} headline="No files" />);
    expect(screen.getByText('No files')).toBeDefined();
  });

  it('renders description when provided', () => {
    render(
      <EmptyState illustration={<svg />} headline="Empty" description="Create your first design" />,
    );
    expect(screen.getByText('Create your first design')).toBeDefined();
  });

  it('renders actions slot', () => {
    render(<EmptyState illustration={<svg />} headline="Empty" actions={<button>CTA</button>} />);
    expect(screen.getByText('CTA')).toBeDefined();
  });
});
