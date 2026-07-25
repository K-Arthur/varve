/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutTipChip } from './ShortcutTipChip';
import type { ShortcutRecommendation } from './shortcutRecommender';

const tip: ShortcutRecommendation = {
  actionId: 'menu:group',
  shortcutId: 'group',
  shortcutLabel: 'Group selection',
  usageCount: 7,
  message: "You've used Group selection 7 times this week. Try Ctrl+G.",
};

describe('ShortcutTipChip', () => {
  it('renders the tip message', () => {
    render(<ShortcutTipChip tip={tip} onDismiss={vi.fn()} onOpenPalette={vi.fn()} />);
    expect(screen.getByText(tip.message)).toBeInTheDocument();
  });

  it('calls onOpenPalette with the shortcutId on click', () => {
    const onOpenPalette = vi.fn();
    render(<ShortcutTipChip tip={tip} onDismiss={vi.fn()} onOpenPalette={onOpenPalette} />);

    fireEvent.click(screen.getByText(tip.message));
    expect(onOpenPalette).toHaveBeenCalledWith('group');
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<ShortcutTipChip tip={tip} onDismiss={onDismiss} onOpenPalette={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Dismiss tip'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('has role="status" for accessibility', () => {
    render(<ShortcutTipChip tip={tip} onDismiss={vi.fn()} onOpenPalette={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
