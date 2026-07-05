import type { Platform } from '@strata/platform';
import { createMemoryPlatform } from '@strata/platform';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShareDialog } from './ShareDialog';

describe('ShareDialog', () => {
  const basePlatform = createMemoryPlatform() as unknown as Platform;

  it('renders file name', async () => {
    const platform: Platform = {
      ...basePlatform,
      listPermissions: vi.fn().mockResolvedValue([]),
    };
    render(
      <ShareDialog fileId="f1" fileName="My Design" platform={platform} open onClose={vi.fn()} />,
    );
    expect(screen.getByText('My Design')).toBeTruthy();
  });

  it('shows people with access', async () => {
    const platform: Platform = {
      ...basePlatform,
      listPermissions: vi.fn().mockResolvedValue([
        { fileId: 'f1', email: 'alice@example.com', role: 'editor', grantedAt: Date.now() },
        { fileId: 'f1', email: 'bob@example.com', role: 'viewer', grantedAt: Date.now() },
      ]),
    };
    render(
      <ShareDialog fileId="f1" fileName="My Design" platform={platform} open onClose={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeTruthy();
    });
    expect(screen.getByText('bob@example.com')).toBeTruthy();
  });

  it('shows empty state when no permissions', async () => {
    const platform: Platform = {
      ...basePlatform,
      listPermissions: vi.fn().mockResolvedValue([]),
    };
    render(
      <ShareDialog fileId="f1" fileName="My Design" platform={platform} open onClose={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText('No one else has access yet.')).toBeTruthy();
    });
  });

  it('adds a new permission', async () => {
    const setPermission = vi.fn().mockResolvedValue(undefined);
    const listPermissions = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { fileId: 'f1', email: 'charlie@example.com', role: 'editor', grantedAt: Date.now() },
      ]);
    const platform: Platform = {
      ...basePlatform,
      listPermissions,
      setPermission,
    };
    render(
      <ShareDialog fileId="f1" fileName="My Design" platform={platform} open onClose={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText('No one else has access yet.')).toBeTruthy();
    });

    const input = screen.getByPlaceholderText('name@example.com');
    fireEvent.change(input, { target: { value: 'charlie@example.com' } });

    const addBtn = screen.getByText('Add');
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(setPermission).toHaveBeenCalledWith('f1', 'editor', 'charlie@example.com');
    });
  });

  it('role dropdown changes role', async () => {
    const platform: Platform = {
      ...basePlatform,
      listPermissions: vi.fn().mockResolvedValue([]),
    };
    render(
      <ShareDialog fileId="f1" fileName="My Design" platform={platform} open onClose={vi.fn()} />,
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: 'commenter' } });
    expect(select.value).toBe('commenter');
  });

  it('closes on Esc', async () => {
    const onClose = vi.fn();
    const platform: Platform = {
      ...basePlatform,
      listPermissions: vi.fn().mockResolvedValue([]),
    };
    const { container } = render(
      <ShareDialog fileId="f1" fileName="My Design" platform={platform} open onClose={onClose} />,
    );

    await waitFor(() => {
      expect(screen.getByText('My Design')).toBeTruthy();
    });

    const dialogEl = container.querySelector('dialog')!;
    expect(dialogEl).toBeTruthy();
    fireEvent.keyDown(dialogEl, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
