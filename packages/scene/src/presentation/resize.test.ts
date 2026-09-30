import { describe, expect, it } from 'vitest';
import { createDocument, type Document, makeFrameNode, makeShapeNode } from '../document';
import {
  applyOperation,
  preconditionFailure,
  registerBuiltinOperations,
  validatePayload,
} from '../operations';
import { applyPresentationResizePreview, previewPresentationResize } from './resize';

registerBuiltinOperations();

function makeDeckDocument(size = { width: 1920, height: 1080 }) {
  const headline = makeShapeNode(
    'headline',
    { kind: 'rect', x: 40, y: 60, w: 600, h: 120 },
    { name: 'Headline', transform: [1, 0, 0, 1, 40, 60] },
  );
  const marker = makeShapeNode(
    'marker',
    { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    { name: 'Marker', transform: [1, 0, 0, 1, 5, 5] },
  );
  const group = {
    id: 'group',
    kind: 'group',
    name: 'Nested',
    transform: [1, 0, 0, 1, 100, 200],
    children: [marker.id],
  } as unknown as Document['nodes'][string];
  const second = makeFrameNode('second', {
    name: 'Second slide',
    w: size.width,
    h: size.height,
    children: [],
  });
  const slide = makeFrameNode('slide', {
    name: 'First slide',
    w: size.width,
    h: size.height,
    children: [headline.id, group.id],
    transform: [1, 0, 0, 1, 0, 0],
  });
  const offDeck = makeFrameNode('off-deck', {
    name: 'Not a slide',
    w: 400,
    h: 400,
    children: [],
    transform: [1, 0, 0, 1, 5000, 5000],
  });
  let document: Document = {
    ...createDocument('Resize test', true),
    nodes: Object.fromEntries(
      [headline, marker, group, second, slide, offDeck].map((node) => [node.id, node]),
    ),
    rootChildren: ['slide', 'second', 'off-deck'],
  };
  document = applyOperation(document, 'presentation.deck.create', {
    id: 'deck',
    name: 'Deck',
    ...size,
  });
  for (const [index, id] of ['slide', 'second'].entries()) {
    document = applyOperation(document, 'presentation.slide.add', {
      deckId: 'deck',
      entry: { id: `entry-${index}`, frameId: id, title: `Slide ${index + 1}` },
    });
  }
  return document;
}

const TO_4_3 = { width: 1440, height: 1080 };

describe('presentation deck resize', () => {
  it('fits uniformly and centres instead of distorting', () => {
    const document = makeDeckDocument();
    const preview = previewPresentationResize(document, 'deck', TO_4_3, 'fit');
    expect(preview.from).toEqual({ width: 1920, height: 1080 });
    expect(preview.to).toEqual(TO_4_3);
    expect(preview.changes).toHaveLength(2);
    expect(preview.warnings.some((warning) => /aspect ratio changes/i.test(warning))).toBe(true);
    expect(preview.warnings.some((warning) => /distorts/i.test(warning))).toBe(false);
  });

  it('distinguishes fit, crop, and an explicitly stretching reflow', () => {
    const document = makeDeckDocument();
    const to = { width: 1080, height: 1920 };
    const content = (preview: ReturnType<typeof previewPresentationResize>) => {
      const change = preview.changes[0]!;
      return {
        w: change.contentScale.x * change.frameFrom.width,
        h: change.contentScale.y * change.frameFrom.height,
        dx: change.contentOffset.x,
        dy: change.contentOffset.y,
        frame: change.frameTo,
      };
    };
    const fit = content(previewPresentationResize(document, 'deck', to, 'fit'));
    const crop = content(previewPresentationResize(document, 'deck', to, 'crop'));
    const reflow = previewPresentationResize(document, 'deck', to, 'reflow');

    // Every mode takes the slide to the chosen size; only content differs.
    expect(fit.frame).toEqual(to);
    expect(crop.frame).toEqual(to);
    expect(reflow.changes[0]!.frameTo).toEqual(to);

    // Fit: uniform 1080/1920, centred vertically with empty space top and bottom.
    expect(fit.w).toBeCloseTo(1080);
    expect(fit.h).toBeCloseTo(607.5);
    expect(fit.dx).toBeCloseTo(0);
    expect(fit.dy).toBeCloseTo(656.25);

    // Crop: uniform 1920/1080, over-fills horizontally and is cut at the edges.
    expect(crop.h).toBeCloseTo(1920);
    expect(crop.w).toBeCloseTo(3413.333333333);
    expect(crop.dy).toBeCloseTo(0);
    expect(crop.dx).toBeCloseTo(-1166.666666666);

    // Reflow: each axis independent — the only mode that changes proportions.
    expect(reflow.changes[0]!.contentScale).toEqual({ x: 1080 / 1920, y: 1920 / 1080 });
    expect(reflow.changes[0]!.contentOffset).toEqual({ x: 0, y: 0 });
    expect(reflow.warnings.join(' ')).toMatch(/changes proportions/);
    expect(previewPresentationResize(document, 'deck', to, 'fit').warnings.join(' ')).not.toMatch(
      /distorts/,
    );
  });

  it('rescales content, leaves canvas positions alone, and scales descendants through composition', () => {
    const document = makeDeckDocument();
    const preview = previewPresentationResize(document, 'deck', TO_4_3, 'reflow');
    const applied = applyPresentationResizePreview(document, preview);

    const frame = applied.nodes.slide;
    expect(frame?.kind === 'frame' ? { width: frame.w, height: frame.h } : null).toEqual(TO_4_3);
    expect(preview.changes[0]!.frameTo).toEqual(TO_4_3);
    // The frame does not move on the canvas.
    expect(frame?.transform).toEqual([1, 0, 0, 1, 0, 0]);

    const child = applied.nodes.headline;
    // Reflow squeezes the horizontal axis only: scale lands in the matrix, not
    // in the shape's geometry, and the translation carries the offset.
    expect(child?.transform).toEqual([0.75, 0, 0, 1, 30, 60]);

    // Nested objects are not walked: only the direct child is rewritten, and
    // its descendant picks the scale up through parent ∘ local composition.
    expect(applied.nodes.group?.transform).toEqual([0.75, 0, 0, 1, 75, 200]);
    expect(applied.nodes.marker?.transform).toEqual([1, 0, 0, 1, 5, 5]);

    // Frames outside the deck are untouched.
    const untouched = applied.nodes['off-deck'];
    expect(untouched?.kind === 'frame' ? untouched.w : null).toBe(400);
    expect(untouched?.transform).toEqual([1, 0, 0, 1, 5000, 5000]);

    // The deck declares the new size.
    expect(applied.presentation!.decks[0]).toMatchObject(TO_4_3);
  });

  it('is reversible: an anisotropic conversion and its inverse round-trip exactly', () => {
    const document = makeDeckDocument();
    const out = previewPresentationResize(document, 'deck', TO_4_3, 'reflow');
    const converted = applyPresentationResizePreview(document, out);
    const back = previewPresentationResize(
      converted,
      'deck',
      { width: 1920, height: 1080 },
      'reflow',
    );
    const restored = applyPresentationResizePreview(converted, back);

    expect(restored.nodes.headline?.transform).toEqual(document.nodes.headline?.transform);
    expect(restored.nodes.slide?.kind === 'frame' ? restored.nodes.slide.w : null).toBe(1920);
    expect(restored.nodes.slide?.kind === 'frame' ? restored.nodes.slide.h : null).toBe(1080);
  });

  it('preserves and reports mixed slide sizes rather than forcing one size', () => {
    const document = makeDeckDocument();
    const oddFrame = document.nodes.second;
    expect(oddFrame?.kind).toBe('frame');
    if (oddFrame?.kind !== 'frame') throw new Error('fixture frame missing');
    const mixed: Document = {
      ...document,
      nodes: {
        ...document.nodes,
        second: { ...oddFrame, w: 800, h: 800 },
      },
    };
    const preview = previewPresentationResize(mixed, 'deck', TO_4_3, 'reflow');
    expect(preview.warnings.join(' ')).toMatch(/1 slide\(s\) are not at the deck/);
    const change = preview.changes.find((entry) => entry.frameId === 'second')!;
    expect(change.differsFromDeck).toBe(true);
    // It still lands on the chosen size, but the content factor is derived from
    // its own geometry rather than the deck's, so its framing is reported.
    expect(change.frameTo).toEqual(TO_4_3);
    expect(change.contentScale.x).toBeCloseTo(1440 / 800);
    expect(change.contentScale.y).toBeCloseTo(1080 / 800);
  });

  it('reports unresolvable references instead of pretending they resized', () => {
    const document = makeDeckDocument();
    const broken: Document = {
      ...document,
      nodes: { ...document.nodes, second: undefined as never },
    };
    const preview = previewPresentationResize(broken, 'deck', TO_4_3, 'fit');
    expect(preview.skippedEntryIds).toEqual(['entry-1']);
    expect(preview.warnings.join(' ')).toMatch(/no usable frame/);
  });

  it('rejects degenerate input before it reaches the document', () => {
    const document = makeDeckDocument();
    expect(() => previewPresentationResize(document, 'deck', { width: 0, height: 1080 })).toThrow(
      /positive/i,
    );
    expect(() =>
      previewPresentationResize(document, 'deck', { width: 1920, height: 1080 }),
    ).toThrow(/already this deck/i);
    expect(() => previewPresentationResize(document, 'missing', TO_4_3)).toThrow(/does not exist/);
    expect(validatePayload('presentation.deck.resize', {})).toMatchObject({ ok: false });
    expect(
      validatePayload('presentation.deck.resize', {
        preview: { deckId: 'deck', mode: 'explode', from: { width: 1, height: 1 }, to: TO_4_3 },
      }),
    ).toMatchObject({ ok: false });
  });

  it('refuses a preview the deck no longer matches', () => {
    const document = makeDeckDocument();
    const preview = previewPresentationResize(document, 'deck', TO_4_3, 'fit');

    expect(preconditionFailure(document, 'presentation.deck.resize', { preview })).toBeNull();
    expect(validatePayload('presentation.deck.resize', { preview })).toMatchObject({ ok: true });

    const moved: Document = {
      ...document,
      presentation: {
        ...document.presentation!,
        decks: [{ ...document.presentation!.decks[0]!, width: 1280 }],
      },
    };
    expect(preconditionFailure(moved, 'presentation.deck.resize', { preview })).toMatch(
      /changed after this preview/,
    );
    expect(() => applyPresentationResizePreview(moved, preview)).toThrow(
      /changed after this preview/,
    );
  });

  it('is one undoable document operation with a readable label', () => {
    const document = makeDeckDocument();
    const preview = previewPresentationResize(document, 'deck', TO_4_3, 'fit');
    const applied = applyOperation(document, 'presentation.deck.resize', { preview });
    expect(applied).not.toBe(document);
    expect(applied.presentation!.decks[0]!.slides).toHaveLength(2);
    expect(validatePayload('presentation.deck.resize', { preview })).toMatchObject({ ok: true });
  });
});
