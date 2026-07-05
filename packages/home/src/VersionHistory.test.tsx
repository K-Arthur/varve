import type { Platform, VersionEntry } from '@strata/platform';
import { createMemoryPlatform } from '@strata/platform';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionHistory } from './VersionHistory';

function makeVersion(id: string, overrides?: Partial<VersionEntry>): VersionEntry {
  return {
    id,
    fileId: 'file-1',
    name: undefined,
    description: undefined,
    documentHash: 'hash',
    timestamp: Date.now(),
    kind: 'auto',
    ...overrides,
  };
}

describe('VersionHistory', () => {
  const basePlatform = createMemoryPlatform() as unknown as Platform;

  it('renders version timeline', async () => {
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockResolvedValue([
        makeVersion('v1', {
          kind: 'named',
          name: 'First draft',
          timestamp: Date.now() - 3600000,
        }),
        makeVersion('v2', {
          kind: 'auto',
          timestamp: Date.now() - 1800000,
        }),
      ]),
    };
    const onRestore = vi.fn();
    render(
      <VersionHistory
        fileId="file-1"
        platform={platform}
        onRestore={onRestore}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Version History')).toBeTruthy();
    });
    expect(screen.getByText('First draft')).toBeTruthy();
    expect(screen.getByText('Auto-save')).toBeTruthy();
  });

  it('groups auto-saves by day', async () => {
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockResolvedValue([
        makeVersion('v1', {
          kind: 'auto',
          timestamp: Date.now() - 7200000,
        }),
        makeVersion('v2', {
          kind: 'auto',
          timestamp: Date.now() - 3600000,
        }),
        makeVersion('v3', {
          kind: 'auto',
          timestamp: Date.now() - 90000000,
        }),
      ]),
    };
    render(
      <VersionHistory fileId="file-1" platform={platform} onRestore={vi.fn()} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Today')).toBeTruthy();
    });
  });

  it('named versions shown with name', async () => {
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockResolvedValue([
        makeVersion('v1', {
          kind: 'named',
          name: 'Client review',
          timestamp: Date.now(),
        }),
      ]),
    };
    render(
      <VersionHistory fileId="file-1" platform={platform} onRestore={vi.fn()} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Client review')).toBeTruthy();
    });
  });

  it('Restore calls onRestore after confirm', async () => {
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockResolvedValue([
        makeVersion('v1', {
          kind: 'named',
          name: 'Final',
          timestamp: Date.now(),
        }),
      ]),
    };
    const onRestore = vi.fn();
    render(
      <VersionHistory
        fileId="file-1"
        platform={platform}
        onRestore={onRestore}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Final')).toBeTruthy();
    });

    const restoreBtn = screen.getByRole('button', { name: 'Restore' });
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(screen.getByText('Restore this version?')).toBeTruthy();
    });

    const confirmBtns = screen.getAllByText('Restore');
    const confirmBtn = confirmBtns[confirmBtns.length - 1]!;
    fireEvent.click(confirmBtn);
    expect(onRestore).toHaveBeenCalledWith('v1');
  });

  it('Save to Version button calls platform.saveVersion', async () => {
    const saveVersion = vi.fn().mockResolvedValue(
      makeVersion('new-v', {
        kind: 'checkpoint',
        timestamp: Date.now(),
      }),
    );
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockResolvedValue([]),
      saveVersion,
    };
    render(
      <VersionHistory fileId="file-1" platform={platform} onRestore={vi.fn()} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('No versions yet')).toBeTruthy();
    });

    const saveBtn = screen.getByText('Save to Version History');
    fireEvent.click(saveBtn);
    expect(saveVersion).toHaveBeenCalledWith('file-1', '', undefined);
  });

  it('empty state when no versions', async () => {
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockResolvedValue([]),
    };
    render(
      <VersionHistory fileId="file-1" platform={platform} onRestore={vi.fn()} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('No versions yet')).toBeTruthy();
    });
    expect(screen.getByText(/track changes, compare/)).toBeTruthy();
  });

  it('loading state', () => {
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    render(
      <VersionHistory fileId="file-1" platform={platform} onRestore={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByText('Loading version history...')).toBeTruthy();
  });

  it('compare button toggles diff placeholder', async () => {
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockResolvedValue([
        makeVersion('v1', {
          kind: 'named',
          name: 'Snapshot A',
          timestamp: Date.now(),
        }),
      ]),
    };
    render(
      <VersionHistory fileId="file-1" platform={platform} onRestore={vi.fn()} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Snapshot A')).toBeTruthy();
    });

    const compareBtn = screen.getByText('Compare');
    fireEvent.click(compareBtn);
    expect(screen.getByText(/Comparing/)).toBeTruthy();

    fireEvent.click(compareBtn);
    expect(screen.queryByText(/Comparing/)).toBeNull();
  });

  it('Restore shows revert confirm dialog', async () => {
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockResolvedValue([
        makeVersion('v1', {
          kind: 'named',
          name: 'Final',
          timestamp: Date.now(),
        }),
      ]),
    };
    const onRestore = vi.fn();
    render(
      <VersionHistory
        fileId="file-1"
        platform={platform}
        onRestore={onRestore}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Final')).toBeTruthy();
    });

    const restoreBtn = screen.getByRole('button', { name: 'Restore' });
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(screen.getByText('Restore this version?')).toBeTruthy();
    });

    const confirmBtns = screen.getAllByText('Restore');
    const confirmBtn = confirmBtns[confirmBtns.length - 1]!;
    fireEvent.click(confirmBtn);
    expect(onRestore).toHaveBeenCalledWith('v1');
  });

  it('better empty state', async () => {
    const platform: Platform = {
      ...basePlatform,
      listVersions: vi.fn().mockResolvedValue([]),
    };
    render(
      <VersionHistory fileId="file-1" platform={platform} onRestore={vi.fn()} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('No versions yet')).toBeTruthy();
    });
    expect(screen.getByText(/track changes, compare snapshots, and restore/)).toBeTruthy();
  });
});
