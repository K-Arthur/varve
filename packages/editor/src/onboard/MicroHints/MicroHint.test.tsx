/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MicroHint } from './MicroHint';
import type { MicroHint as MicroHintData } from './microHintsData';

const HINT: MicroHintData = {
  id: 'rect.first-use',
  title: 'Rectangle',
  body: 'Click and drag to draw. Hold Shift for a square.',
  category: 'tools',
  duration: 5000,
};

describe('MicroHint', () => {
  it('renders title and body', () => {
    render(<MicroHint hint={HINT} onDismiss={vi.fn()} />);
    expect(screen.getByText('Rectangle')).toBeInTheDocument();
    expect(screen.getByText(/Click and drag/)).toBeInTheDocument();
  });

  it('calls onDismiss when dismiss button clicked', async () => {
    const onDismiss = vi.fn();
    render(<MicroHint hint={HINT} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByLabelText('Dismiss hint'));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });

  it('has role=status for screen readers', () => {
    render(<MicroHint hint={HINT} onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
