/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import type { Platform } from '@strata/platform';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeShell } from './HomeShell';

function createMockPlatform(): Platform {
  return {
    kind: 'memory',
    getViewState: vi.fn().mockResolvedValue({}),
    listFiles: vi.fn().mockResolvedValue([]),
    listTrashedFiles: vi.fn().mockResolvedValue([]),
    listProjects: vi.fn().mockResolvedValue([]),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    listTemplates: vi.fn().mockResolvedValue([]),
    listSavedSearches: vi.fn().mockResolvedValue([]),
    setViewState: vi.fn(),
    listenForChanges: vi.fn(() => Promise.resolve(() => {})),
    fileExists: vi.fn().mockResolvedValue(true),
  } as unknown as Platform;
}

describe('HomeShell startup', () => {
  let mockPlatform: Platform;

  beforeEach(() => {
    mockPlatform = createMockPlatform();
  });

  it('calls onReady after loading completes', async () => {
    const onReady = vi.fn();
    render(<HomeShell platform={mockPlatform} onOpenFile={vi.fn()} onReady={onReady} />);
    await waitFor(() => {
      expect(onReady).toHaveBeenCalledOnce();
    });
  });

  it('renders ContentSkeleton while loading', () => {
    const slowPlatform = {
      ...mockPlatform,
      getViewState: () => new Promise(() => {}),
      listFiles: () => new Promise(() => {}),
      listTrashedFiles: () => new Promise(() => {}),
      listProjects: () => new Promise(() => {}),
      listWorkspaces: () => new Promise(() => {}),
    } as unknown as Platform;

    render(<HomeShell platform={slowPlatform} onOpenFile={vi.fn()} />);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
});
