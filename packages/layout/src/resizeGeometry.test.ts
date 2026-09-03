import { type Fill, makeShapeNode, type SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { resizeNodeGeometry } from './resizeGeometry';

describe('resizeNodeGeometry', () => {
  it('scales affine gradient fields with bounds-relative geometry', () => {
    const gradient: Fill = {
      type: 'gradient',
      gradient: {
        type: 'linear',
        stops: [
          { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
          { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
        ],
        transform: [100, 0, 0, 50, 10, 20],
      },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const node = {
      ...makeShapeNode('rect', { kind: 'rect', x: 10, y: 20, w: 100, h: 50 }),
      fills: [gradient],
    } as unknown as SceneNode;

    const resized = resizeNodeGeometry(node, 200, 100);
    expect(resized.kind).toBe('shape');
    if (resized.kind !== 'shape' || resized.fills?.[0]?.type !== 'gradient') return;
    expect(resized.fills[0].gradient?.transform).toEqual([200, 0, 0, 100, 10, 20]);
  });
});
