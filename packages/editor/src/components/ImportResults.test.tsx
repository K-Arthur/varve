// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BatchImportResult } from '@varve/import';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportResults } from './ImportResults';

function makeResult(overrides: Partial<BatchImportResult> = {}): BatchImportResult {
  return {
    document: {
      id: '',
      name: '',
      formatVersion: '1',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    },
    nodeIds: [],
    results: [],
    successCount: 0,
    failCount: 0,
    warnings: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe('ImportResults', () => {
  it('shows success count message', () => {
    const result = makeResult({ successCount: 12, failCount: 2 });
    render(<ImportResults result={result} onClose={() => {}} />);
    expect(screen.getByText(/12 files imported successfully/i)).toBeTruthy();
  });

  it('shows failure count when there are failures', () => {
    const result = makeResult({ successCount: 8, failCount: 3 });
    render(<ImportResults result={result} onClose={() => {}} />);
    expect(screen.getByText(/3 files failed/i)).toBeTruthy();
  });

  it('shows warning count when there are warnings', () => {
    const result = makeResult({
      successCount: 5,
      failCount: 0,
      results: [{ name: 'a.svg', success: true, warnings: ['Test warning'], nodeIds: ['n1'] }],
      warnings: ['Test warning'],
    });
    const { container } = render(<ImportResults result={result} onClose={() => {}} />);
    expect(container.querySelector('.import-results__stat--warn')?.textContent).toMatch(
      /1 file with warnings/i,
    );
  });

  it('renders close button', () => {
    const result = makeResult({ successCount: 1, failCount: 0 });
    const { container } = render(<ImportResults result={result} onClose={() => {}} />);
    const btn = container.querySelector('.import-results__close');
    expect(btn).toBeTruthy();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    const result = makeResult({ successCount: 1, failCount: 0 });
    const { container } = render(<ImportResults result={result} onClose={onClose} />);
    const btn = container.querySelector('.import-results__close') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows individual file results in list', () => {
    const result = makeResult({
      successCount: 2,
      failCount: 0,
      results: [
        { name: 'logo.svg', success: true, warnings: [], nodeIds: ['n1'] },
        { name: 'icon.svg', success: true, warnings: [], nodeIds: ['n2'] },
      ],
    });
    const { container } = render(<ImportResults result={result} onClose={() => {}} />);
    const toggle = container.querySelector('.import-results__toggle') as HTMLButtonElement;
    fireEvent.click(toggle);
    const names = container.querySelectorAll('.import-results__file-name');
    expect(names.length).toBe(2);
    expect(names[0]?.textContent).toBe('logo.svg');
    expect(names[1]?.textContent).toBe('icon.svg');
  });

  it('shows file warnings when expanded', async () => {
    const result = makeResult({
      successCount: 1,
      failCount: 0,
      results: [
        {
          name: 'complex.svg',
          success: true,
          warnings: ['Gradient approximated', 'Font fallback used'],
          nodeIds: ['n1'],
        },
      ],
      warnings: ['Gradient approximated', 'Font fallback used'],
    });
    const { container } = render(<ImportResults result={result} onClose={() => {}} />);
    const toggle = container.querySelector('.import-results__toggle') as HTMLButtonElement;
    fireEvent.click(toggle);
    const warningItems = container.querySelectorAll('.import-results__file-warning-list li');
    expect(warningItems.length).toBe(2);
    expect(warningItems[0]?.textContent).toMatch(/gradient approximated/i);
  });

  it('handles all-failed result', () => {
    const result = makeResult({ successCount: 0, failCount: 4 });
    render(<ImportResults result={result} onClose={() => {}} />);
    expect(screen.getByText(/4 files failed/i)).toBeTruthy();
  });

  it('handles empty result', () => {
    const result = makeResult({ successCount: 0, failCount: 0 });
    render(<ImportResults result={result} onClose={() => {}} />);
    expect(screen.getByText(/no files/i)).toBeTruthy();
  });
});
