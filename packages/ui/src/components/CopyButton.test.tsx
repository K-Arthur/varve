// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  it('renders with aria-label', () => {
    const { container } = render(<CopyButton value="test-value" label="Width" />);
    const btn = container.querySelector('button');
    expect(btn?.getAttribute('aria-label')).toBe('Copy Width');
  });

  it('copies value to clipboard on click', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(<CopyButton value="200px" label="Width" />);
    (container.querySelector('button') as HTMLElement).click();
    expect(writeText).toHaveBeenCalledWith('200px');
  });
});
