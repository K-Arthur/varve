/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileQueue, type FileQueueItem } from './FileQueue';

const items: FileQueueItem[] = [
  { id: 'a', file: { name: 'a.png', size: 1024, type: 'image/png' }, status: 'complete' },
  {
    id: 'b',
    file: { name: 'a.png', size: 2048, type: 'image/png' },
    status: 'failed',
    error: 'Image dimensions exceed the import limit.',
  },
  { id: 'c', file: { name: 'long-file-name.svg', size: 4096 }, status: 'processing', progress: 40 },
];

describe('FileQueue', () => {
  it('preserves duplicate names and renders per-file states', () => {
    render(<FileQueue items={items} />);
    expect(screen.getAllByText('a.png')).toHaveLength(2);
    expect(screen.getByText(/Complete/)).toBeDefined();
    expect(screen.getByText(/Failed/)).toBeDefined();
    expect(
      screen.getByRole('progressbar', { name: 'Processing long-file-name.svg' }),
    ).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('Image dimensions exceed the import limit.')).toBeDefined();
  });

  it('supports retry and removal actions', () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(<FileQueue items={items} onRetry={onRetry} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry a.png' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove a.png' })[0]!);
    expect(onRetry).toHaveBeenCalledWith('b');
    expect(onRemove).toHaveBeenCalledWith('a');
  });
});
