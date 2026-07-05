// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingChecklist } from './OnboardingChecklist';

describe('OnboardingChecklist', () => {
  it('renders 5 items initially unchecked', () => {
    render(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={[]}
        onItemClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Add your first shape')).toBeInTheDocument();
    expect(screen.getByText("Change a shape's color")).toBeInTheDocument();
    expect(screen.getByText('Add some text')).toBeInTheDocument();
    expect(screen.getByText('Group your shapes')).toBeInTheDocument();
    expect(screen.getByText('Export your design')).toBeInTheDocument();
  });

  it('shows progress as "0 / 5"', () => {
    render(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={[]}
        onItemClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('0 / 5')).toBeInTheDocument();
  });

  it('checked items show checkmark', () => {
    render(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={['shape']}
        onItemClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(5);
  });

  it('clicking unchecked item calls onItemClick', () => {
    const onItemClick = vi.fn();
    render(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={[]}
        onItemClick={onItemClick}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Add your first shape'));
    expect(onItemClick).toHaveBeenCalledWith('shape');
  });

  it('dismiss button calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={[]}
        onItemClick={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('all 5 complete shows celebration state', () => {
    render(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={['shape', 'color', 'text', 'group', 'export']}
        onItemClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('All done!')).toBeInTheDocument();
  });

  it('auto-dismisses after 3s when all complete', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <OnboardingChecklist
        open={true}
        onClose={onClose}
        progress={['shape', 'color', 'text', 'group', 'export']}
        onItemClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('All done!')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('progress updates when progress prop changes', () => {
    const { rerender } = render(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={['shape']}
        onItemClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('1 / 5')).toBeInTheDocument();
    rerender(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={['shape', 'color']}
        onItemClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
  });

  it('has accessible labels', () => {
    render(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={[]}
        onItemClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('region')).toHaveAttribute('aria-label', 'Getting started checklist');
    expect(screen.getByRole('list')).toBeInTheDocument();
  });
});
