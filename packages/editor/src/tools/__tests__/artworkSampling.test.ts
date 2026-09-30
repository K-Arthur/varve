import { addNode, createDocument, imageFill, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  documentForArtworkSampling,
  fitArtworkSampleBounds,
  matteTransparentArtworkWhite,
} from '../artworkSampling';

describe('bounded visible-artwork samples', () => {
  it('keeps a full 4096-square source inside the area-selection pixel budget', () => {
    expect(fitArtworkSampleBounds({ left: 0, top: 0, right: 4096, bottom: 4096 })).toEqual({
      x: 0,
      y: 0,
      width: 4096,
      height: 4096,
    });
  });

  it('refuses oversized samples instead of returning clipped artwork', () => {
    expect(fitArtworkSampleBounds({ left: 0, top: 0, right: 8192, bottom: 4096 })).toBeNull();
    expect(fitArtworkSampleBounds({ left: 0, top: 0, right: 16_385, bottom: 1 })).toBeNull();
  });

  it('uses a white paper matte for transparent linework and antialiased edges', () => {
    const imageData = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 128]),
    } as ImageData;

    expect(Array.from(matteTransparentArtworkWhite(imageData).data)).toEqual([
      255, 255, 255, 255, 127, 127, 127, 255,
    ]);
  });

  it('excludes opted-out reference nodes only in the immutable sampling snapshot', () => {
    const reference = {
      ...makeShapeNode('reference', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
      fills: [imageFill('data:image/png;base64,AA==')],
      conceptArtReference: {
        sourceFileName: 'forest.png',
        includeInSampling: false,
        includeInExport: false,
      },
    };
    const artwork = makeShapeNode('artwork', { kind: 'rect', x: 30, y: 0, w: 20, h: 20 });
    const document = addNode(addNode(createDocument('Reference sample'), reference), artwork);

    const sampleDocument = documentForArtworkSampling(document);

    expect(sampleDocument).not.toBe(document);
    expect(sampleDocument.nodes.reference?.visible).toBe(false);
    expect(sampleDocument.nodes.artwork).toBe(document.nodes.artwork);
    expect(document.nodes.reference?.visible).toBe(true);
  });

  it('includes references only after sampling is explicitly enabled', () => {
    const reference = {
      ...makeShapeNode('reference', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
      fills: [imageFill('data:image/png;base64,AA==')],
      conceptArtReference: {
        sourceFileName: 'forest.png',
        includeInSampling: true,
        includeInExport: false,
      },
    };
    const document = addNode(createDocument('Reference sample'), reference);

    expect(documentForArtworkSampling(document)).toBe(document);
  });

  it('leaves ordinary image nodes untouched', () => {
    const ordinaryImage = {
      ...makeShapeNode('ordinary-image', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
      fills: [imageFill('data:image/png;base64,AA==')],
    };
    const document = addNode(createDocument('Ordinary image'), ordinaryImage);

    expect(documentForArtworkSampling(document)).toBe(document);
  });
});
