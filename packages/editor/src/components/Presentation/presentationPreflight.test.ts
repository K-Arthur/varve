import {
  applyOperation,
  createDocument,
  type Document,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  registerBuiltinOperations,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { runPresentationPreflight } from './presentationPreflight';

registerBuiltinOperations();

function makeDeck(document: Document, frameId: string): Document {
  const next = applyOperation(document, 'presentation.deck.create', {
    id: 'deck',
    name: 'Presentation',
    width: 1280,
    height: 720,
  });
  return applyOperation(next, 'presentation.slide.add', {
    deckId: 'deck',
    entry: { id: 'slide', frameId, title: 'Opening' },
  });
}

describe('runPresentationPreflight', () => {
  it('reports text size, unfinished placeholders, off-slide shapes, and missing descriptions', () => {
    const frame = makeFrameNode('frame', {
      w: 1280,
      h: 720,
      children: ['text', 'shape'],
    });
    const text = makeTextNode('text', '[Title]', {
      fontSize: 12,
      w: 250,
      transform: [1, 0, 0, 1, 20, 20],
    });
    const shape = makeShapeNode(
      'shape',
      { kind: 'rect', x: 0, y: 0, w: 80, h: 60 },
      { transform: [1, 0, 0, 1, 1250, 680] },
    );
    const document = makeDeck(
      {
        ...createDocument('preflight', true),
        nodes: { frame, text, shape },
      },
      frame.id,
    );

    expect(
      runPresentationPreflight(document, 'deck')
        .map(({ code }) => code)
        .sort(),
    ).toEqual(['missing-alt', 'off-slide', 'placeholder', 'small-text']);
  });

  it('checks nested transformed bounds, unavailable resources, and known-color contrast', () => {
    const frame = makeFrameNode('frame', {
      w: 1280,
      h: 720,
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      children: ['group', 'text', 'image'],
    });
    const group = makeGroupNode('group', {
      transform: [2, 0, 0, 2, 0, 0],
      children: ['shape'],
    });
    const shape = makeShapeNode(
      'shape',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
      { transform: [1, 0, 0, 1, 640, 300] },
    );
    const text = makeTextNode('text', '[Title]', {
      fontFamily: 'Unavailable Sans',
      fontSize: 12,
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    });
    const image = {
      ...makeShapeNode('image', { kind: 'rect', x: 0, y: 0, w: 120, h: 90 }),
      fills: [
        {
          type: 'image' as const,
          image: { src: '', fit: 'fill' as const, x: 0, y: 0, scale: 1 },
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
    };
    const document = makeDeck(
      {
        ...createDocument('preflight resources', true),
        nodes: { frame, group, shape, text, image },
        fontManifest: {
          version: 2,
          fonts: [
            {
              familyName: 'Unavailable Sans',
              identity: {
                contentHash: 'a'.repeat(64),
                postScriptName: 'UnavailableSans-Regular',
                familyName: 'Unavailable Sans',
                subfamilyName: 'Regular',
                fullName: 'Unavailable Sans Regular',
              },
              source: 'missing',
              embeddingRights: 'unknown',
              status: 'missing',
            },
          ],
        } as NonNullable<Document['fontManifest']>,
      },
      frame.id,
    );

    expect(
      runPresentationPreflight(document, 'deck')
        .map(({ code }) => code)
        .sort(),
    ).toEqual([
      'low-contrast',
      'missing-alt',
      'missing-asset',
      'missing-font',
      'off-slide',
      'placeholder',
      'small-text',
    ]);
  });

  it('marks missing included artwork as a blocker and skips omitted slides', () => {
    let document = makeDeck(createDocument('preflight missing', true), 'deleted-frame');
    expect(runPresentationPreflight(document, 'deck')[0]).toMatchObject({
      code: 'missing-frame',
      severity: 'blocker',
    });

    document = applyOperation(document, 'presentation.slide.update', {
      deckId: 'deck',
      entryId: 'slide',
      update: { skipped: true },
    });
    expect(runPresentationPreflight(document, 'deck')).toEqual([]);
  });
});
