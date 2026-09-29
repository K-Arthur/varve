import { describe, expect, it } from 'vitest';
import { normalizeAdjustmentStack } from './adjustmentNormalization';
import { makeAdjustment } from './adjustments';
import { addNode, createDocument, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';

describe('tonal compatibility and resource-free persistence', () => {
  it('round trips the actual document codec with all tonal kinds and source intact', () => {
    const kinds = ['curves', 'channelMixer', 'whiteBalance', 'splitTone', 'sharpen'] as const;
    const adjustments = kinds.map((kind) => makeAdjustment(kind, kind));
    const node = {
      ...makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }),
      smartFilters: adjustments,
    };
    expect(node.smartFilters).toEqual(adjustments);
    const doc = addNode(createDocument('Tonal codec', true), node);
    const result = DocumentCodec.decode(DocumentCodec.encode(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('codec rejected tonal document');
    expect(result.document.nodes.shape).toMatchObject({
      smartFilters: adjustments,
      shape: node.shape,
    });
  });

  it('keeps the old curve version and selected output row when fields are absent', () => {
    const { adjustments } = normalizeAdjustmentStack(
      [
        { kind: 'curves', channel: 'red', points: [{ input: 77.25, output: 99.75 }] },
        {
          kind: 'channelMixer',
          outputChannel: 'blue',
          redPercent: 80,
          greenPercent: 10,
          bluePercent: 20,
        },
      ],
      'layer',
    );
    expect(adjustments[0]).toMatchObject({
      algorithmVersion: 1,
      points: [{ input: 77.25, output: 99.75 }],
    });
    expect(adjustments[1]).toMatchObject({ outputChannel: 'blue', redPercent: 80 });
    expect('rows' in adjustments[1]!).toBe(false);
  });
  it('retains all channel points, fractional precision, ids and independent rows offline', () => {
    const values = [
      {
        kind: 'curves',
        algorithmVersion: 2,
        channel: 'green',
        points: [],
        channelPoints: {
          red: [
            { id: 'point-red', input: 0, output: 12.345 },
            { input: 255, output: 255 },
          ],
          blue: [
            { input: 0, output: 0 },
            { input: 255, output: 190 },
          ],
        },
      },
      {
        kind: 'channelMixer',
        rows: {
          red: { redPercent: -50, greenPercent: 150, bluePercent: 0, constant: 7 },
          green: { redPercent: 0, greenPercent: 100, bluePercent: 0, constant: 0 },
          blue: { redPercent: 100, greenPercent: 0, bluePercent: 0, constant: -2 },
        },
      },
    ];
    const first = normalizeAdjustmentStack(values, 'layer');
    const second = normalizeAdjustmentStack(JSON.parse(JSON.stringify(first.adjustments)), 'layer');
    expect(second.adjustments).toEqual(first.adjustments);
    expect(second.adjustments[0]).toMatchObject({ channelPoints: values[0]!.channelPoints });
    expect(second.adjustments[1]).toMatchObject({ rows: values[1]!.rows });
  });
});
