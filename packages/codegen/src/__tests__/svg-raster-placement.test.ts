import { createDocument, makeGroupNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToSvg } from '../svg';

describe('SVG raster fallback placement', () => {
  it('uses the compositor placement transform for a world-cropped boundary', () => {
    const doc = createDocument('raster placement');
    const boundary = makeGroupNode('boundary', { name: 'Clipped paint' });
    const svg = exportNodeToSvg(boundary, doc, {
      rasterAssets: {
        [boundary.id]: {
          nodeId: boundary.id,
          dataUrl: 'data:image/png;base64,AA==',
          pixelWidth: 140,
          pixelHeight: 90,
          cssWidth: 140,
          cssHeight: 90,
          placementTransform: [1, 0, 0, 1, 420, 130],
        },
      },
    });

    expect(svg).toContain('viewBox="420 130 140 90"');
    expect(svg).toContain('width="140" height="90" transform="matrix(1,0,0,1,420,130)"');
  });
});
