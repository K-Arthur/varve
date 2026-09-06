/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createMemoryPlatform, makeFileEntry } from '@varve/platform';
import { describe, expect, it, vi } from 'vitest';
import { fileThumbnailIdentity, useThumbnailLoader } from './useThumbnailLoader';

describe('useThumbnailLoader cache repair', () => {
  it('asks the host renderer to repair a missing thumbnail', async () => {
    const platform = createMemoryPlatform();
    const entry = makeFileEntry({ id: 'file-1', name: 'Legacy design' });
    await platform.upsertFile(entry, JSON.stringify({ id: 'file-1' }));
    const savedEntry = (await platform.getFile(entry.id))!;
    const dataUrl = 'data:image/png;base64,thumbnail';
    const generate = vi.fn().mockResolvedValue(dataUrl);

    const { result } = renderHook(() => useThumbnailLoader(platform, generate));
    act(() => result.current.load(savedEntry));

    await waitFor(() => expect(result.current.thumbnails.get(entry.id)).toBe(dataUrl));
    expect(generate).toHaveBeenCalledOnce();
  });

  it('does not invoke repair when a canonical thumbnail exists', async () => {
    const platform = createMemoryPlatform();
    const entry = makeFileEntry({ id: 'file-2', name: 'Cached design' });
    await platform.upsertFile(entry, JSON.stringify({ id: 'file-2', rootChildren: [], nodes: {} }));
    const savedEntry = (await platform.getFile(entry.id))!;
    const canonical = fileThumbnailIdentity(savedEntry);
    await platform.putThumbnail({
      hash: canonical.key,
      dataUrl: 'data:image/png;base64,cached',
      width: 256,
      height: 192,
      createdAt: Date.now(),
    });
    const generate = vi.fn().mockResolvedValue('data:image/png;base64,generated');

    const { result } = renderHook(() => useThumbnailLoader(platform, generate));
    act(() => result.current.load(savedEntry));

    await waitFor(() =>
      expect(result.current.thumbnails.get(entry.id)).toBe('data:image/png;base64,cached'),
    );
    expect(generate).not.toHaveBeenCalled();
  });
});
