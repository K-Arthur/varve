/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplatesGallery } from './TemplatesGallery';

describe('TemplatesGallery', () => {
  it('renders built-in templates', () => {
    render(<TemplatesGallery onSelect={vi.fn()} />);
    expect(screen.getByText('Blank Canvas')).toBeDefined();
    expect(screen.getByText('Instagram Post')).toBeDefined();
    expect(screen.getByText('A4 Document')).toBeDefined();
  });

  it('calls onSelect when a template is clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(<TemplatesGallery onSelect={onSelect} />);
    const buttons = container.querySelectorAll('button.template-card');
    const blankBtn = Array.from(buttons).find((b) => b.textContent?.includes('Blank Canvas'));
    expect(blankBtn).toBeDefined();
    if (!blankBtn) throw new Error('blankBtn not found');
    fireEvent.click(blankBtn);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
