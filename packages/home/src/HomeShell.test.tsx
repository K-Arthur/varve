/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryPlatform } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeShell } from './HomeShell';

describe('HomeShell', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('shows a sane PerfProfile render duration (not a wall-clock delta)', async () => {
    // Regression: Date.now() passed as renderStartTime while PerfProfile uses
    // performance.now() → ~-1.78e12 ms.
    const platform = createMemoryPlatform();
    render(<HomeShell platform={platform} onOpenFile={vi.fn()} />);

    const profile = await screen.findByLabelText('Performance profile');
    const msText = profile.textContent?.match(/(-?\d+)ms/)?.[1];
    expect(msText).toBeDefined();
    const ms = Number(msText);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(60_000);
  });

  it('renders toolbar with New and Open buttons', async () => {
    const platform = createMemoryPlatform();
    const { container } = render(<HomeShell platform={platform} onOpenFile={vi.fn()} />);
    expect(container.textContent).toContain('New');
    expect(container.textContent).toContain('Open');
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
        expect(container.textContent).toContain('Nothing here yet');
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
        expect(container.textContent).toContain('Nothing here yet');
      },
      { timeout: 3000 },
    );
  });

  it('does not render WorkspaceSwitcher when no workspaces exist', async () => {
    const platform = createMemoryPlatform();
    const { queryByLabelText } = render(<HomeShell platform={platform} onOpenFile={vi.fn()} />);
    await waitFor(
      () => {
        expect(queryByLabelText('Switch workspace')).toBeNull();
      },
      { timeout: 3000 },
    );
  });
});
