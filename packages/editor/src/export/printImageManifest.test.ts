import { describe, expect, it } from 'vitest';
import { collectImageFillSrcs } from './printImageManifest';

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
