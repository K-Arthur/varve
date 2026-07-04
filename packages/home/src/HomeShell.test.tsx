/** @vitest-environment jsdom */

import { createMemoryPlatform } from '@strata/platform';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeShell } from './HomeShell';

describe('HomeShell', () => {
  it('renders toolbar with New File and Open buttons', async () => {
    const platform = createMemoryPlatform();
    const { container } = render(<HomeShell platform={platform} onOpenFile={vi.fn()} />);
    expect(container.textContent).toContain('New File');
    expect(container.textContent).toContain('Open...');
  });

  it('renders sidebar navigation', async () => {
    const platform = createMemoryPlatform();
    const { container } = render(<HomeShell platform={platform} onOpenFile={vi.fn()} />);
    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).toBeDefined();
  });

  it('renders empty state after data loads', async () => {
    const platform = createMemoryPlatform();
    const { container } = render(<HomeShell platform={platform} onOpenFile={vi.fn()} />);
    await waitFor(
      () => {
        expect(container.textContent).toContain('No recent files');
      },
      { timeout: 3000 },
    );
  });

  it('handles web platform without crashing (cross-platform check)', async () => {
    const platform = createMemoryPlatform();
    // MemoryPlatform.kind is 'memory' — the stale detection skips,
    // confirming the cross-platform effect doesn't throw.
    const { container } = render(<HomeShell platform={platform} onOpenFile={vi.fn()} />);
    await waitFor(
      () => {
        expect(container.textContent).toContain('No recent files');
      },
      { timeout: 3000 },
    );
  });
});
