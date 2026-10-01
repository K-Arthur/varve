import { describe, expect, it } from 'vitest';
import { collectImageFillSrcs, countPatternFillsWithoutTileSource } from './printImageManifest';

describe('print image resource source collection', () => {
  it('includes visible image and pattern tiles, deduplicating later during manifest assembly', () => {
    const sources = collectImageFillSrcs([
      {
        fills: [
          { type: 'image', image: { src: 'data:image/png;base64,image' } },
          { type: 'pattern', pattern: { tileSrc: 'data:image/png;base64,pattern' } },
          { type: 'pattern', pattern: { tileSrc: 'data:image/png;base64,pattern' } },
          { type: 'pattern', visible: false, pattern: { tileSrc: 'hidden.png' } },
        ],
      },
    ]);

    expect(sources).toEqual([
      'data:image/png;base64,image',
      'data:image/png;base64,pattern',
      'data:image/png;base64,pattern',
    ]);
  });
});

describe('missing pattern resource detection', () => {
  it('counts only visible pattern fills with an empty tile source', () => {
    const count = countPatternFillsWithoutTileSource([
      {
        fills: [
          { type: 'pattern', pattern: { tileSrc: '' } },
          { type: 'pattern', tileSrc: '  ' },
          { type: 'pattern', visible: false, pattern: { tileSrc: '' } },
          { type: 'image', tileSrc: '' },
          { type: 'pattern', pattern: { tileSrc: 'data:image/png;base64,abc' } },
        ],
      },
    ]);

    expect(count).toBe(2);
  });
});
