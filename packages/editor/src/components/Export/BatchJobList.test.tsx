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
    expect(screen.getByText('50.0KB')).toBeTruthy();
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
});
