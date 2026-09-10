// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AnimatedSeparator, Separator, SeparatorWithContent } from './Separator';

afterEach(cleanup);

describe('Separator', () => {
  it('renders a semantic horizontal separator by default', () => {
    render(<Separator data-testid="rule" />);
    const rule = screen.getByTestId('rule');
    expect(rule).not.toHaveAttribute('role', 'presentation');
    expect(rule).toHaveAttribute('aria-orientation', 'horizontal');
    expect(rule).toHaveClass('varve-separator--default');
  });

  it('supports vertical orientation and variants', () => {
    render(<Separator orientation="vertical" variant="dashed" tone="strong" data-testid="rule" />);
    const rule = screen.getByTestId('rule');
    expect(rule).toHaveAttribute('aria-orientation', 'vertical');
    expect(rule).toHaveClass('varve-separator--vertical', 'varve-separator--dashed');
  });

  it('marks decorative rules and merges consumer classes', () => {
    render(<Separator decorative className="custom-rule" data-testid="rule" />);
    const rule = screen.getByTestId('rule');
    expect(rule).toHaveAttribute('role', 'presentation');
    expect(rule).toHaveAttribute('aria-hidden', 'true');
    expect(rule).toHaveClass('custom-rule');
  });

  it('composes arbitrary content without adding semantic separator noise', () => {
    render(<SeparatorWithContent align="start">Advanced options</SeparatorWithContent>);
    expect(screen.getByText('Advanced options')).toBeInTheDocument();
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });

  it('keeps animation opt-in and removable', () => {
    const { rerender } = render(<AnimatedSeparator active={false} data-testid="rule" />);
    expect(screen.getByTestId('rule')).not.toHaveClass('varve-separator--animated-active');
    rerender(<AnimatedSeparator data-testid="rule" />);
    expect(screen.getByTestId('rule')).toHaveClass('varve-separator--animated-active');
  });
});
