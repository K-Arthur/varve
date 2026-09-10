import { createDocument, makeTextNode } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { collectDocumentFontFaces } from './useDocumentFonts';

describe('collectDocumentFontFaces', () => {
  it('requests the default artwork face for legacy text without a family', () => {
    const node = makeTextNode('legacy', 'Imported text');
    const doc = {
      ...createDocument('Legacy font document'),
      nodes: {
        legacy: { ...node, fontFamily: undefined },
      },
    };

    expect(collectDocumentFontFaces(doc)).toEqual([
      {
        family: DEFAULT_ARTWORK_FONT_FAMILY,
        weight: 400,
        style: 'normal',
      },
    ]);
  });

  it('requests inherited and run-specific faces from rich text', () => {
    const node = makeTextNode('rich', 'Fallback mirror', {
      fontFamily: 'Body Sans',
      richText: {
        paragraphs: [
          {
            runs: [
              { text: 'Body' },
              { text: 'Display', format: { fontFamily: 'Display Sans', fontWeight: 700 } },
            ],
          },
        ],
      },
    });
    const doc = { ...createDocument('Rich font document'), nodes: { rich: node } };

    expect(collectDocumentFontFaces(doc)).toEqual(
      expect.arrayContaining([
        { family: 'Body Sans', weight: 400, style: 'normal' },
        { family: 'Display Sans', weight: 700, style: 'normal' },
      ]),
    );
  });
});
