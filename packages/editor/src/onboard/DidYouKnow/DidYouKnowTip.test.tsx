// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DidYouKnowTip } from './DidYouKnowTip';
import type { Tip } from './tips';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeTip(overrides: Partial<Tip> = {}): Tip {
  return {
    id: 'test-tip',
    title: 'Test Tip Title',
    body: 'Test tip body text that explains the feature.',
    category: 'shortcuts',
    ...overrides,
  };
}

describe('DidYouKnowTip', () => {
  it('renders tip title and body', () => {
    const tip = makeTip();
    render(<DidYouKnowTip tip={tip} onDismiss={vi.fn()} onDontShowAgain={vi.fn()} />);
    expect(screen.getByText(tip.title)).toBeInTheDocument();
    expect(screen.getByText(tip.body)).toBeInTheDocument();
  });

  it('"Got it" calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<DidYouKnowTip tip={makeTip()} onDismiss={onDismiss} onDontShowAgain={vi.fn()} />);
    fireEvent.click(screen.getByText('Got it'));
    expect(onDismiss).toHaveBeenCalledWith('test-tip');
  });

  it('"Don\'t show again" calls onDontShowAgain', () => {
    const onDontShowAgain = vi.fn();
    render(<DidYouKnowTip tip={makeTip()} onDismiss={vi.fn()} onDontShowAgain={onDontShowAgain} />);
    fireEvent.click(screen.getByText("Don't show again"));
    expect(onDontShowAgain).toHaveBeenCalledWith('test-tip');
  });

  it('auto-dismisses after 8 seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<DidYouKnowTip tip={makeTip()} onDismiss={onDismiss} onDontShowAgain={vi.fn()} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(onDismiss).toHaveBeenCalledWith('test-tip');
  });

  it('has role="status" and aria-live="polite"', () => {
    render(<DidYouKnowTip tip={makeTip()} onDismiss={vi.fn()} onDontShowAgain={vi.fn()} />);
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('respects prefers-reduced-motion (no animation)', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<DidYouKnowTip tip={makeTip()} onDismiss={vi.fn()} onDontShowAgain={vi.fn()} />);
    const tipEl = document.querySelector('.did-you-know-tip');
    expect(tipEl).toBeTruthy();
    expect(tipEl?.classList.contains('did-you-know-tip--no-animation')).toBe(true);

    window.matchMedia = original;
  });

  it('slides in from bottom-right (has correct start position)', () => {
    render(<DidYouKnowTip tip={makeTip()} onDismiss={vi.fn()} onDontShowAgain={vi.fn()} />);
    const tipEl = document.querySelector('.did-you-know-tip');
    expect(tipEl).toBeTruthy();
    // The animation name should be the slide-in from bottom-right
    const anim = getComputedStyle(tipEl!).animationName;
    expect(anim).toBe('did-you-know-slide-in');
  });

  it('keyboard accessible (Tab to buttons)', () => {
    render(<DidYouKnowTip tip={makeTip()} onDismiss={vi.fn()} onDontShowAgain={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    // All buttons should be focusable
    for (const btn of buttons) {
      expect(btn).not.toHaveAttribute('tabindex', '-1');
    }
  });
});
