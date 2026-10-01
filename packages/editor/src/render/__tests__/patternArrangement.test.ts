import { createEngine } from '@varve/engine';
import { describe, expect, it } from 'vitest';

describe('pattern arrangement through the IR', () => {
  it('carries arrangement/gaps/phase/mirror into FillIR', async () => {
    const engine = await createEngine('stub');
    const ir = await engine.buildIr({
      nodes: [
        {
          id: 'n1',
          kind: 'shape',
          name: 'Rect',
          transform: [1, 0, 0, 1, 0, 0],
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'pattern',
              pattern: {
                tileSrc: 'data:image/png;base64,AA',
                spacing: 0,
                rotation: 0,
                arrangement: 'half-drop',
                gapX: 4,
                gapY: 2,
                offsetX: 3,
                mirrorX: true,
                alignment: 'document',
              },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        },
      ],
    } as never);

    const fill = ir[0]?.fills?.[0] as Record<string, unknown> | undefined;
    expect(fill).toMatchObject({
      type: 'pattern',
      arrangement: 'half-drop',
      gapX: 4,
      gapY: 2,
      offsetX: 3,
      mirrorX: true,
      alignment: 'document',
    });
  });
});
