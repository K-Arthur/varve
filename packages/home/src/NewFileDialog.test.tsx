/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TemplateLibrary } from '@strata/platform';
import { NewFileDialog } from './NewFileDialog';

const MOCK_TEMPLATES: TemplateLibrary[] = [
  {
    id: 'blank',
    name: 'Blank Canvas',
    category: 'General',
    description: 'Start empty.',
    previewHash: '',
    source: 'builtin',
    documentJson: '{}',
    tags: [],
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0,
  },
];

describe('NewFileDialog', () => {
  it('renders blank tab with a blank canvas option when open', () => {
    const { container } = render(<NewFileDialog open onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(container.textContent).toContain('Blank canvas');
  });

  it('switches to templates tab', () => {
    const { container } = render(
      <NewFileDialog open onClose={vi.fn()} onCreate={vi.fn()} templates={MOCK_TEMPLATES} />,
    );
    const tabs = container.querySelectorAll('button');
    const templateTab = Array.from(tabs).find((b) => b.textContent?.trim() === 'Templates');
    expect(templateTab).toBeDefined();
    if (!templateTab) throw new Error('templateTab not found');
    fireEvent.click(templateTab);
    expect(container.textContent).toContain('Blank Canvas');
  });

  it('calls onClose when cancel clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<NewFileDialog open onClose={onClose} onCreate={vi.fn()} />);
    const buttons = container.querySelectorAll('button');
    const cancelBtn = Array.from(buttons).find((b) => b.textContent?.trim() === 'Cancel');
    expect(cancelBtn).toBeDefined();
    if (!cancelBtn) throw new Error('cancelBtn not found');
    fireEvent.click(cancelBtn);
    // The onClose is called by the button inside the Dialog
    expect(onClose).toHaveBeenCalledOnce();
  });
});
