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

  it('shows the number of committed paste or drop layers', () => {
    const result = {
      startedAt: 0,
      completedAt: 1,
      durationMs: 1,
      totalFiles: 1,
      successCount: 1,
      partialCount: 0,
      failureCount: 0,
      unsupportedCount: 0,
      files: [],
      warnings: [],
      insertedCount: 3,
      route: 'drop' as const,
    };
    render(<ImportResults result={result} onClose={() => {}} />);
    expect(screen.getByText(/3 layers inserted/i)).toBeTruthy();
  });

  it('offers to reveal the roots committed by an ingestion route', () => {
    const onRevealSelection = vi.fn();
    const result = {
      startedAt: 0,
      completedAt: 1,
      durationMs: 1,
      totalFiles: 1,
      successCount: 1,
      partialCount: 1,
      failureCount: 0,
      unsupportedCount: 0,
      files: [],
      warnings: [
        { code: 'fidelity-change', message: 'one fidelity change', severity: 'warning' as const },
      ],
      insertedCount: 2,
      committedRootIds: ['n1', 'n2'],
      documentId: 'doc-1',
      route: 'paste' as const,
    };
    render(
      <ImportResults result={result} onClose={() => {}} onRevealSelection={onRevealSelection} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reveal selection/i }));
    expect(onRevealSelection).toHaveBeenCalledWith(['n1', 'n2'], 'doc-1');
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

  it('shows format-level capabilities separately from per-file losses', () => {
    const result = {
      startedAt: 0,
      completedAt: 1,
      durationMs: 1,
      totalFiles: 1,
      successCount: 0,
      partialCount: 1,
      failureCount: 0,
      unsupportedCount: 0,
      warnings: [],
      files: [
        {
          name: 'layout.pdf',
          source: 'file-picker' as const,
          format: 'pdf',
          status: 'partial' as const,
          byteCount: 1,
          durationMs: 1,
          nodeCount: 1,
          artifacts: [],
          warnings: [
            {
              code: 'parser.warning',
              message: 'Text approximated',
              severity: 'warning' as const,
            },
          ],
          unsupportedFeatures: [],
          capabilities: {
            format: 'pdf',
            multipage: false,
            pageDimensions: false,
            vectors: false,
            text: true,
            images: false,
            masters: false,
            textThreads: false,
            notes: [],
          },
        },
      ],
    };
    const { container } = render(<ImportResults result={result} onClose={() => {}} />);
    const toggle = container.querySelector('.import-results__toggle') as HTMLButtonElement;
    fireEvent.click(toggle);
    const summary = container.querySelector('.import-results__file-capabilities');
    expect(summary?.textContent).toMatch(/format-level: vectors not preserved/i);
    expect(summary?.textContent).toMatch(/text preserved/i);
    // Per-layer losses stay in the warning list, not the capability summary.
    const warningItems = container.querySelectorAll('.import-results__file-warning-list li');
    expect(warningItems.length).toBe(1);
    expect(warningItems[0]?.getAttribute('data-code')).toBe('parser.warning');
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
