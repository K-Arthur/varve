/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createMemoryPlatform, makeFileEntry } from '@varve/platform';
import { describe, expect, it } from 'vitest';
import { useRecentFiles } from '../useRecentFiles';

describe('useRecentFiles', () => {
  it('does not expose orphaned history rows in Open Recent', async () => {
    const platform = createMemoryPlatform();
    await platform.upsertFile(makeFileEntry({ id: 'live', name: 'Live' }), '{}');
    await platform.touchRecentFile('live', 'Live');
    await platform.touchRecentFile('orphan', 'Deleted');

    const { result } = renderHook(() => useRecentFiles(platform));
    await waitFor(() => expect(result.current.entries.map((entry) => entry.id)).toEqual(['live']));
  });

  it('refreshes after removing a recent record', async () => {
    const platform = createMemoryPlatform();
    await platform.upsertFile(makeFileEntry({ id: 'live', name: 'Live' }), '{}');
    await platform.touchRecentFile('live', 'Live');

    const { result } = renderHook(() => useRecentFiles(platform));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.remove('live'));
    await waitFor(() => expect(result.current.entries).toHaveLength(0));
  });
});
