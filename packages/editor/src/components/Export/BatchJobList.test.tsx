// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ExportJob } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchJobList } from './BatchJobList';

afterEach(cleanup);

function makeJob(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    presetId: 'p1',
    nodeId: 'n1',
    nodeName: 'Rect',
    format: 'png',
    fileName: 'rect.png',
    dimensions: { w: 100, h: 80 },
    estimatedSize: 51200,
    status: 'pending',
    ...overrides,
  };
}

describe('BatchJobList', () => {
  it('shows job rows', () => {
    render(
      <BatchJobList
        jobs={[makeJob()]}
        selectedIds={new Set(['n1-p1'])}
        onToggleJob={() => {}}
        onToggleAll={() => {}}
      />,
    );
    expect(screen.getByText('rect.png')).toBeTruthy();
    expect(screen.getByText('50.0 KB')).toBeTruthy();
  });

  it('select-all toggles all', () => {
    const onToggleAll = vi.fn();
    render(
      <BatchJobList
        jobs={[
          makeJob({ presetId: 'p1', nodeId: 'n1' }),
          makeJob({ presetId: 'p2', nodeId: 'n2', fileName: 'rect2.png' }),
        ]}
        selectedIds={new Set(['n1-p1', 'n2-p2'])}
        onToggleJob={() => {}}
        onToggleAll={onToggleAll}
      />,
    );
    const selectAll = screen.getByLabelText('Select all jobs');
    fireEvent.click(selectAll);
    expect(onToggleAll).toHaveBeenCalled();
  });

  it('shows empty state when no jobs', () => {
    render(
      <BatchJobList
        jobs={[]}
        selectedIds={new Set()}
        onToggleJob={() => {}}
        onToggleAll={() => {}}
      />,
    );
    expect(screen.getByText('No export jobs to display.')).toBeTruthy();
  });

  it('renders all job status icons', () => {
    const jobs: ExportJob[] = [
      makeJob({ status: 'pending' }),
      makeJob({ presetId: 'p2', nodeId: 'n2', fileName: 'r2.png', status: 'running' }),
      makeJob({ presetId: 'p3', nodeId: 'n3', fileName: 'r3.png', status: 'done' }),
      makeJob({ presetId: 'p4', nodeId: 'n4', fileName: 'r4.png', status: 'error', error: 'fail' }),
    ];
    render(
      <BatchJobList
        jobs={jobs}
        selectedIds={new Set()}
        onToggleJob={() => {}}
        onToggleAll={() => {}}
      />,
    );
    expect(screen.getByLabelText('Select all jobs')).toBeTruthy();
    expect(screen.getByText('r3.png')).toBeTruthy();
    expect(screen.getByText('r4.png')).toBeTruthy();
  });

  it('labels the dimension column and keeps PPI visible beside it', () => {
    const { container } = render(
      <BatchJobList
        jobs={[makeJob({ outputPpi: 300, dimensions: { w: 2480, h: 3508 } })]}
        selectedIds={new Set()}
        onToggleJob={() => {}}
        onToggleAll={() => {}}
      />,
    );
    expect(screen.getByText('Dimensions')).toBeTruthy();
    expect(screen.getByText('Size')).toBeTruthy();
    const dims = container.querySelector('.batch-job-row__dims');
    expect(dims?.textContent).toBe('2480 \u00d7 3508 300 PPI');
    expect(container.querySelector('.batch-job-row__ppi')?.textContent).toBe('300 PPI');
  });

  it('renders the format badge uppercase through the shared component', () => {
    const { container } = render(
      <BatchJobList
        jobs={[makeJob({ format: 'pdf-x1a', fileName: 'card.pdf' })]}
        selectedIds={new Set()}
        onToggleJob={() => {}}
        onToggleAll={() => {}}
      />,
    );
    expect(container.querySelector('.format-badge')?.textContent).toBe('PDF/X-1a');
  });

  it('exposes pressed state on the format filter chips', () => {
    render(
      <BatchJobList
        jobs={[
          makeJob({ presetId: 'p1', nodeId: 'n1', format: 'png' }),
          makeJob({ presetId: 'p2', nodeId: 'n2', format: 'svg', fileName: 'rect.svg' }),
        ]}
        selectedIds={new Set()}
        onToggleJob={() => {}}
        onToggleAll={() => {}}
      />,
    );
    const all = screen.getByRole('button', { name: 'All (2)' });
    expect(all.getAttribute('aria-pressed')).toBe('true');
    const svgChip = screen.getByRole('button', { name: 'SVG (1)' });
    fireEvent.click(svgChip);
    expect(svgChip.getAttribute('aria-pressed')).toBe('true');
    expect(all.getAttribute('aria-pressed')).toBe('false');
  });

  it('uses a provided empty state instead of the default line', () => {
    render(
      <BatchJobList
        jobs={[]}
        selectedIds={new Set()}
        onToggleJob={() => {}}
        onToggleAll={() => {}}
        emptyState={<p>Nothing configured yet</p>}
      />,
    );
    expect(screen.getByText('Nothing configured yet')).toBeTruthy();
    expect(screen.queryByText('No export jobs to display.')).toBeNull();
  });
});
