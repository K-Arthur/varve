/** @vitest-environment jsdom */

import { createMemoryPlatform } from '@varve/platform';
import { describe, expect, it, vi } from 'vitest';
import { ingestHomeFiles } from './homeFileDrop';

describe('ingestHomeFiles', () => {
  it('opens a single native document and stores dropped assets locally', async () => {
    const platform = createMemoryPlatform();
    const onOpenFile = vi.fn();
    const document = new File([JSON.stringify({ name: 'Poster' })], 'poster.varve', {
      type: 'application/json',
    });

    const failures = await ingestHomeFiles([document], platform, 'workspace-1', onOpenFile);

    expect(failures).toEqual([]);
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'poster' }));
    expect(await platform.listFiles()).toHaveLength(1);

    const assetFailures = await ingestHomeFiles(
      [new File(['image'], 'reference.png', { type: 'image/png' })],
      platform,
      'workspace-1',
      onOpenFile,
    );
    expect(assetFailures).toEqual([]);
    expect(await platform.listAssets('workspace-1')).toHaveLength(1);
    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it('keeps valid files when a batch contains malformed content', async () => {
    const platform = createMemoryPlatform();
    const failures = await ingestHomeFiles(
      [
        new File(['not json'], 'broken.varve', { type: 'application/json' }),
        new File(['image'], 'valid.png', { type: 'image/png' }),
      ],
      platform,
      'workspace-1',
      vi.fn(),
    );

    expect(failures).toEqual(['broken.varve: This Varve document is not valid JSON.']);
    expect(await platform.listFiles()).toHaveLength(0);
    expect(await platform.listAssets('workspace-1')).toHaveLength(1);
  });
});
