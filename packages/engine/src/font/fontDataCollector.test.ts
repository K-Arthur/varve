import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fontReferenceKey } from './fontIdentity';

const { getEntries } = vi.hoisted(() => ({
  getEntries: vi.fn(),
}));

vi.mock('../fontRegistry', () => ({
  getFontRegistry: () => ({ getEntries }),
}));

import { collectFontData } from './fontDataCollector';

const firstReference = { artifactHash: 'a'.repeat(64), collectionIndex: 0 };
const secondReference = {
  artifactHash: 'dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d986',
  collectionIndex: 1,
};

describe('collectFontData exact requests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getEntries.mockReturnValue([
      {
        family: 'Shared Family',
        weight: 400,
        style: 'normal',
        source: 'bundled',
        url: '/fonts/shared-member-0.woff2',
        faceKey: fontReferenceKey(firstReference),
      },
      {
        family: 'Shared Family',
        weight: 700,
        style: 'normal',
        source: 'bundled',
        url: '/fonts/shared-member-1.woff2',
        faceKey: fontReferenceKey(secondReference),
      },
    ]);
  });

  it('fetches the requested registered member instead of the first family entry', async () => {
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(new Uint8Array([url.endsWith('1.woff2') ? 2 : 1]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await collectFontData(
      [{ family: 'Shared Family', fontReference: secondReference }],
      { fetchBundled: true },
    );

    expect(fetchMock).toHaveBeenCalledWith('/fonts/shared-member-1.woff2', expect.anything());
    expect(result).toHaveLength(1);
    expect(result[0]?.fontReference).toEqual(secondReference);
    expect([...result[0]!.data]).toEqual([2]);
  });

  it('does not silently fall back to a different face when the exact member is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await collectFontData(
      [
        {
          family: 'Shared Family',
          fontReference: { artifactHash: 'c'.repeat(64), collectionIndex: 4 },
        },
      ],
      { fetchBundled: true },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rejects bytes whose artifact hash does not match the exact request', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([2]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    getEntries.mockReturnValue([
      {
        family: 'Shared Family',
        weight: 700,
        style: 'normal',
        source: 'bundled',
        url: '/fonts/modified-member-1.woff2',
        faceKey: fontReferenceKey({
          artifactHash: '1'.repeat(64),
          collectionIndex: 1,
        }),
      },
    ]);

    const result = await collectFontData(
      [
        {
          family: 'Shared Family',
          fontReference: { artifactHash: '1'.repeat(64), collectionIndex: 1 },
        },
      ],
      { fetchBundled: true },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual([]);
  });
});
