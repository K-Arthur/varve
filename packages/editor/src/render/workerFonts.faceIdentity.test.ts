// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { adoptFontFacesDetailed, workerHasFontsForDocument } from './workerFonts';

const firstFaceKey = `sha256:${'a'.repeat(64)}:single`;
const secondFaceKey = `sha256:${'b'.repeat(64)}:0`;

describe('render worker exact face admission', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a document while its requested artifact/member is not adopted', () => {
    const doc = {
      nodes: {
        text: {
          kind: 'text',
          fontFamily: 'Shared Sans',
          fontReference: { artifactHash: 'a'.repeat(64) },
        },
      },
    };

    expect(
      workerHasFontsForDocument(
        {
          unavailableFontFamilies: new Set(),
          unavailableFontFaceKeys: new Set([firstFaceKey]),
        },
        doc as never,
      ),
    ).toBe(false);
    expect(
      workerHasFontsForDocument(
        {
          unavailableFontFamilies: new Set(),
          unavailableFontFaceKeys: new Set(),
        },
        doc as never,
      ),
    ).toBe(true);
  });

  it('reports exactly the successfully adopted face keys', async () => {
    class FakeFontFace {
      constructor(
        readonly family: string,
        readonly source: string,
      ) {}

      async load(): Promise<FakeFontFace> {
        return this;
      }
    }
    const added: unknown[] = [];
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('fonts', { add: (face: unknown) => added.push(face) });

    const result = await adoptFontFacesDetailed([
      { family: 'Shared Sans', source: 'url(/first.woff2)', faceKey: firstFaceKey },
      { family: 'Shared Sans', source: 'url(/second.woff2)', faceKey: secondFaceKey },
    ]);

    expect(result.families).toEqual(['Shared Sans']);
    expect(result.faceKeys).toEqual([firstFaceKey, secondFaceKey]);
    expect(added).toHaveLength(2);
  });
});
