import { describe, expect, it } from 'vitest';
import { containDepthPreview, depthPreviewPointToMap } from './depthPreviewLayout';

describe('depth preview layout', () => {
  it('contains an asymmetric map without stretching or cropping', () => {
    const layout = containDepthPreview(4, 2, 300, 200);

    expect(layout.canvasWidth).toBe(4);
    expect(layout.canvasHeight).toBe(2);
    expect(layout.drawWidth / layout.drawHeight).toBe(2);
    expect(layout.drawX).toBe(0);
    expect(layout.drawY).toBe(0);
  });

  it('keeps contain bars out of depth sampling', () => {
    const layout = containDepthPreview(4, 2, 3, 3);
    const rect = { left: 10, top: 20, width: 3, height: 3 };

    expect(depthPreviewPointToMap(10, 20.5, rect, layout)).toEqual({ x: 0, y: 0 });
    expect(depthPreviewPointToMap(11, 22.9, rect, layout)).toBeNull();
    expect(depthPreviewPointToMap(12.9, 21, rect, layout)).toEqual({ x: 3, y: 0 });
    expect(depthPreviewPointToMap(13.1, 21, rect, layout)).toBeNull();
  });

  it('maps the final displayed pixel to the final source pixel', () => {
    const layout = containDepthPreview(400, 200, 300, 200);
    const rect = { left: 0, top: 0, width: layout.canvasWidth, height: layout.canvasHeight };

    expect(depthPreviewPointToMap(299.999, 149.999, rect, layout)).toEqual({ x: 399, y: 199 });
  });
});
