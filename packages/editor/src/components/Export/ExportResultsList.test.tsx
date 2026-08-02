// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportFileReport } from '../../exportService';
import { ExportResultsList } from './ExportResultsList';

afterEach(cleanup);

function makeFile(overrides: Partial<ExportFileReport> = {}): ExportFileReport {
  return {
    fileName: 'rect.png',
    format: 'png',
    nodeId: 'n1',
    status: 'success',
    mimeType: 'image/png',
    byteCount: 51200,
    durationMs: 120,
    warnings: [],
    ...overrides,
  };
}

describe('ExportResultsList', () => {
  it('renders nothing for an empty report', () => {
    const { container } = render(<ExportResultsList files={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('summarizes success counts', () => {
    render(
      <ExportResultsList
        files={[
          makeFile(),
          makeFile({ fileName: 'rect2.png', format: 'png' }),
          makeFile({
            fileName: 'bad.png',
            nodeId: 'n2',
            status: 'failed',
            error: 'Engine not ready',
          }),
        ]}
      />,
    );
    expect(screen.getByText(/2 of 3 exported \u00b7 1 failed/i)).toBeTruthy();
    expect(screen.getByText('rect.png')).toBeTruthy();
    expect(screen.getByText('bad.png')).toBeTruthy();
    expect(screen.getByText('Engine not ready')).toBeTruthy();
  });

  it('shows size and duration metadata for successful files', () => {
    render(<ExportResultsList files={[makeFile()]} />);
    expect(screen.getByText(/image\/png \u00b7 50.0KB \u00b7 120ms/i)).toBeTruthy();
  });

  it('renders a retry action only when failures exist and a callback is provided', () => {
    const onRetryFailed = vi.fn();
    render(
      <ExportResultsList
        files={[
          makeFile(),
          makeFile({ fileName: 'bad.png', nodeId: 'n2', status: 'failed', error: 'boom' }),
        ]}
        onRetryFailed={onRetryFailed}
      />,
    );
    const retry = screen.getByRole('button', { name: /retry failed \(1\)/i });
    fireEvent.click(retry);
    expect(onRetryFailed).toHaveBeenCalledOnce();
  });

  it('omits the retry action when nothing failed', () => {
    render(<ExportResultsList files={[makeFile()]} onRetryFailed={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /retry failed/i })).toBeNull();
  });

  it('does not render a retry button without a callback even on failure', () => {
    render(
      <ExportResultsList
        files={[makeFile({ fileName: 'bad.png', nodeId: 'n2', status: 'failed', error: 'x' })]}
      />,
    );
    expect(screen.queryByRole('button', { name: /retry failed/i })).toBeNull();
  });
});
