import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingLabel } from './LoadingLabel';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('is decorative by default', () => {
    const { container } = render(<Spinner />);
    const spinner = container.querySelector('.varve-spinner');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
    expect(spinner).not.toHaveAttribute('role');
  });

  it('supports a standalone accessible label', () => {
    render(<Spinner label="Refreshing assets" size="md" />);
    expect(screen.getByRole('img', { name: 'Refreshing assets' })).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveClass('varve-spinner--md');
  });

  it('announces visible loading copy through LoadingLabel, not the SVG', () => {
    render(<LoadingLabel label="Preparing export" />);
    expect(screen.getByRole('status')).toHaveTextContent('Preparing export');
    expect(screen.getByRole('status').querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
