// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeDialog } from './WelcomeDialog';

describe('WelcomeDialog', () => {
  it('renders 3 option buttons', () => {
    render(
      <WelcomeDialog
        open={true}
        onStartTour={vi.fn()}
        onStartTemplate={vi.fn()}
        onStartBlank={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Take the tour')).toBeInTheDocument();
    expect(screen.getByText('Start with a template')).toBeInTheDocument();
    expect(screen.getByText('Blank canvas')).toBeInTheDocument();
  });

  it('"Blank canvas" calls onStartBlank', () => {
    const onStartBlank = vi.fn();
    render(
      <WelcomeDialog
        open={true}
        onStartTour={vi.fn()}
        onStartTemplate={vi.fn()}
        onStartBlank={onStartBlank}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Blank canvas'));
    expect(onStartBlank).toHaveBeenCalledTimes(1);
  });

  it('"Take the tour" calls onStartTour', () => {
    const onStartTour = vi.fn();
    render(
      <WelcomeDialog
        open={true}
        onStartTour={onStartTour}
        onStartTemplate={vi.fn()}
        onStartBlank={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Take the tour'));
    expect(onStartTour).toHaveBeenCalledTimes(1);
  });

  it('"Start with a template" calls onStartTemplate', () => {
    const onStartTemplate = vi.fn();
    render(
      <WelcomeDialog
        open={true}
        onStartTour={vi.fn()}
        onStartTemplate={onStartTemplate}
        onStartBlank={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Start with a template'));
    expect(onStartTemplate).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(
      <WelcomeDialog
        open={true}
        onStartTour={vi.fn()}
        onStartTemplate={vi.fn()}
        onStartBlank={vi.fn()}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has correct ARIA attributes', () => {
    render(
      <WelcomeDialog
        open={true}
        onStartTour={vi.fn()}
        onStartTemplate={vi.fn()}
        onStartBlank={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Welcome to Strata');
  });
});
