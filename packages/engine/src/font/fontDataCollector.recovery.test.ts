import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fontReferenceKey } from './fontIdentity';

const { getEntries, loadFontFromFilesystem, loadStoredFont } = vi.hoisted(() => ({
  getEntries: vi.fn(),
  loadFontFromFilesystem: vi.fn(),
  loadStoredFont: vi.fn(),
}));

vi.mock('../fontRegistry', () => ({
  getFontRegistry: () => ({ getEntries }),
}));
vi.mock('./fontStorageFs', () => ({ loadFontFromFilesystem }));
vi.mock('./fontStorage', () => ({
  listStoredFonts: vi.fn(async () => []),
  loadStoredFont,
}));

import { collectFontData } from './fontDataCollector';

const exactReference = {
  artifactHash: 'dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d986',
  collectionIndex: 1,
};

describe('collectFontData recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    loadStoredFont.mockResolvedValue(undefined);
    loadFontFromFilesystem.mockResolvedValue({
      data: new Uint8Array([9]),
      meta: { family: 'Shared Family', storedAt: '', fileSizeBytes: 1, sha256: 'wrong' },
    });
    getEntries.mockReturnValue([
      {
        family: 'Shared Family',
        weight: 700,
        style: 'normal',
        source: 'bundled',
        url: '/fonts/shared-member-1.woff2',
        faceKey: fontReferenceKey(exactReference),
      },
    ]);
  });

  it('falls through to a verified bundled copy after corrupt stored bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([2]), { status: 200 })),
    );

    const result = await collectFontData([
      { family: 'Shared Family', fontReference: exactReference },
    ]);

    expect(result).toHaveLength(1);
    expect([...result[0]!.data]).toEqual([2]);
    expect(result[0]!.fontReference).toEqual(exactReference);
  });
});
