import type { Platform } from '@strata/platform';
import { createMemoryPlatform } from '@strata/platform';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityFeed } from './ActivityFeed';

function makeEvent(
  id: string,
  type: string,
  overrides?: Partial<{
    fileId: string;
    projectId: string;
    timestamp: number;
    metadata: Record<string, string>;
  }>,
) {
  return {
    id,
    workspaceId: 'ws-1',
    type,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ActivityFeed', () => {
  const basePlatform = createMemoryPlatform() as unknown as Platform;

  it('renders activity events', async () => {
    const platform: Platform = {
      ...basePlatform,
      listActivity: vi.fn().mockResolvedValue([
        makeEvent('e1', 'created', {
          fileId: 'f1',
          metadata: { fileName: 'Design v1' },
          timestamp: Date.now() - 60000,
        }),
        makeEvent('e2', 'modified', {
          fileId: 'f2',
          metadata: { fileName: 'Prototype' },
          timestamp: Date.now() - 300000,
        }),
      ]),
    };
    render(
      <ActivityFeed
        platform={platform}
        workspaceId="ws-1"
        onOpenFile={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Design v1')).toBeTruthy();
    });
    expect(screen.getByText('Prototype')).toBeTruthy();
    expect(screen.getByText('created')).toBeTruthy();
    expect(screen.getByText('modified')).toBeTruthy();
  });

  it('groups events by time period', async () => {
    const now = Date.now();
    const platform: Platform = {
      ...basePlatform,
      listActivity: vi.fn().mockResolvedValue([
        makeEvent('e1', 'created', {
          fileId: 'f1',
          timestamp: now - 60000,
          metadata: { fileName: 'Recent' },
        }),
        makeEvent('e2', 'created', {
          fileId: 'f2',
          timestamp: now - 200000000,
          metadata: { fileName: 'Old' },
        }),
      ]),
    };
    render(
      <ActivityFeed
        platform={platform}
        workspaceId="ws-1"
        onOpenFile={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Today')).toBeTruthy();
    });
    expect(screen.getByText('Older')).toBeTruthy();
  });

  it('shows empty state', async () => {
    const platform: Platform = {
      ...basePlatform,
      listActivity: vi.fn().mockResolvedValue([]),
    };
    render(
      <ActivityFeed
        platform={platform}
        workspaceId="ws-1"
        onOpenFile={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('No recent activity')).toBeTruthy();
    });
  });

  it('event click triggers navigation', async () => {
    const platform: Platform = {
      ...basePlatform,
      listActivity: vi.fn().mockResolvedValue([
        makeEvent('e1', 'created', {
          fileId: 'f1',
          metadata: { fileName: 'Design v1' },
          timestamp: Date.now(),
        }),
      ]),
    };
    const onOpenFile = vi.fn();
    render(
      <ActivityFeed
        platform={platform}
        workspaceId="ws-1"
        onOpenFile={onOpenFile}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Design v1')).toBeTruthy();
    });

    const eventBtn = screen.getByText('Design v1').closest('button');
    expect(eventBtn).toBeTruthy();
    fireEvent.click(eventBtn!);
    expect(onOpenFile).toHaveBeenCalledWith('f1');
  });
});
