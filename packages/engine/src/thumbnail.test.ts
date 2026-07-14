/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { buildThumbnailScene, renderThumbnail } from './thumbnail';

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

  it('includes text and resolves nested frame transforms', () => {
    const scene = buildThumbnailScene({
      id: 'nested',
      name: 'Nested',
      nodes: {
        frame: {
          id: 'frame',
          name: 'Frame',
          kind: 'frame',
          transform: [1, 0, 0, 1, 100, 80],
          w: 300,
          h: 200,
          children: ['text'],
        },
        text: {
          id: 'text',
          name: 'Text',
          kind: 'text',
          transform: [1, 0, 0, 1, 20, 30],
          text: 'Visible thumbnail text',
          fontSize: 18,
          w: 180,
          h: 40,
        },
      },
    });

    const text = scene.nodes.find((node) => node.id === 'text');
    expect(text?.kind).toBe('text');
    expect(text?.transform).toEqual([1, 0, 0, 1, 120, 110]);
    expect(text?.text).toBe('Visible thumbnail text');
  });
});
