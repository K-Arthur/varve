/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { renderThumbnail } from './thumbnail';

describe('renderThumbnail', () => {
  it('returns null for empty document', async () => {
    const doc = { id: 'test', name: 'Empty', nodes: {} };
    const result = await renderThumbnail(doc);
    expect(result).toBeNull();
  });

  it('renders a document with a rect', async () => {
    const doc = {
      id: 'test',
      name: 'Test',
      nodes: {
        n1: {
          id: 'n1',
          name: 'Rect',
          kind: 'shape' as const,
          shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
          transform: [1, 0, 0, 1, 0, 0] as const,
          fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 },
        },
      },
    };
    const result = await renderThumbnail(doc, { maxW: 128, maxH: 96 });
    expect(result).not.toBeNull();
    expect(result).toMatch(/^data:image\/png/);
  });
});
