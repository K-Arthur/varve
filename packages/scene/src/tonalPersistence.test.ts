import { describe, expect, it } from 'vitest';
import { normalizeAdjustmentStack } from './adjustmentNormalization';
import { makeAdjustment } from './adjustments';
import { createEmbeddedAsset } from './assets';
import { addNode, createDocument, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';
import { imageFill } from './fills';
import { addRasterMaskAsset } from './masks';

describe('tonal compatibility and resource-free persistence', () => {
  it('keeps the embedded original, crop, mask and named partial coverage alongside the stack', () => {
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQAAAABazTCJAAAADElEQVQI12M4wHAAAAMEAYHFO6KpAAAAAElFTkSuQmCC';
    const asset = createEmbeddedAsset({
      dataUrl,
      mimeType: 'image/png',
      naturalWidth: 2,
      naturalHeight: 2,
    });
    const adjustments = (
      ['curves', 'channelMixer', 'whiteBalance', 'splitTone', 'sharpen'] as const
    ).map((kind) => makeAdjustment(kind, kind));
    const node = {
      ...makeShapeNode('source', { kind: 'rect', x: 3, y: 5, w: 100, h: 80 }),
      fills: [
        imageFill(dataUrl, { assetId: asset.id, fit: 'crop', imageWidth: 2, imageHeight: 2 }),
      ],
      smartFilters: adjustments,
    };
    node.fills[0]!.image!.crop = { x: 1, y: 0, w: 1, h: 2 };
    let doc = addNode(createDocument('Tonal resources', true), node);
    doc = {
      ...doc,
      assets: { [asset.id]: asset },
      savedAreaSelections: [
        {
          id: 'coverage-id',
          name: 'Red snapshot',
          createdAt: 1,
          selection: {
            coordinateSpace: 'document',
            generation: 1,
            expression: {
              kind: 'shape',
              shape: {
                kind: 'raster-mask',
                x: 3,
                y: 5,
                w: 100,
                h: 80,
                width: 2,
                height: 2,
                data: 'AH//QA==',
                boundary: [],
                transform: [1, 0, 0, 1, 0, 0],
                inverseTransform: [1, 0, 0, 1, 0, 0],
                feather: 0,
                antialias: true,
              },
            },
          },
        },
      ],
    };
    doc = addRasterMaskAsset(doc, node.id, {
      id: 'mask-id',
      mimeType: 'image/png',
      dataUrl,
      width: 2,
      height: 2,
      byteLength: 69,
    });
    const reopened = DocumentCodec.decode(DocumentCodec.encode(doc));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error('resource closure rejected');
    expect(reopened.document.assets?.[asset.id]).toEqual(asset);
    expect(reopened.document.nodes.source).toMatchObject({
      smartFilters: adjustments,
      fills: node.fills,
      mask: { rasterMask: { assetId: 'mask-id' } },
    });
    expect(reopened.document.rasterMaskAssets?.['mask-id']?.dataUrl).toBe(dataUrl);
    expect(reopened.document.savedAreaSelections).toEqual(doc.savedAreaSelections);
  });
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
  it('pins old sharpen files to their legacy operator and retains new domain options', () => {
    const current = makeAdjustment('new-detail', 'sharpen', {
      amount: 80,
      radius: 1.75,
      workingSpace: 'srgb',
    });
    const result = normalizeAdjustmentStack(
      [{ kind: 'sharpen', amount: 70, radius: 2, threshold: 3 }, current],
      'layer',
    );
    expect(result.adjustments[0]).toMatchObject({ algorithmVersion: 1, amount: 70, radius: 2 });
    expect(result.adjustments[1]).toEqual(current);
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
