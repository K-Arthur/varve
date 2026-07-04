/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormatMigration } from './FormatMigration';

describe('FormatMigration', () => {
  const baseResults = [
    { name: 'design.svg', success: true, warnings: ['Gradient approximation'] },
    { name: 'layout.ai', success: true, warnings: [] },
    { name: 'broken.eps', success: false, warnings: ['Unsupported PostScript feature'] },
  ];

  it('shows success and warning counts', () => {
    const { container } = render(
      <FormatMigration open onClose={vi.fn()} results={baseResults} />,
    );
    expect(container.textContent).toContain('3 files imported');
    expect(container.textContent).toContain('2 files with unsupported features');
  });

  it('shows empty state when no results', () => {
    const { container } = render(
      <FormatMigration open onClose={vi.fn()} results={[]} />,
    );
    expect(container.textContent).toContain('No files were processed.');
  });

  it('shows per-file report when expanded', () => {
    const { container } = render(
      <FormatMigration open onClose={vi.fn()} results={baseResults} />,
    );
    const toggle = container.querySelector('.format-migration__toggle')!;
    fireEvent.click(toggle);
    expect(container.textContent).toContain('design.svg');
    expect(container.textContent).toContain('layout.ai');
    expect(container.textContent).toContain('broken.eps');
  });

  it('calls onViewReport when report button clicked', () => {
    const onViewReport = vi.fn();
    const { container } = render(
      <FormatMigration
        open
        onClose={vi.fn()}
        results={[baseResults[0]!]}
        onViewReport={onViewReport}
      />,
    );
    const toggle = container.querySelector('.format-migration__toggle')!;
    fireEvent.click(toggle);

    const reportBtn = container.querySelector('.format-migration__file-report')!;
    fireEvent.click(reportBtn);
    expect(onViewReport).toHaveBeenCalledWith(baseResults[0]);
  });

  it('calls onClose when Done clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <FormatMigration open onClose={onClose} results={baseResults} />,
    );
    const doneBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Done',
    );
    expect(doneBtn).toBeTruthy();
    fireEvent.click(doneBtn!);
    expect(onClose).toHaveBeenCalled();
  });
});
