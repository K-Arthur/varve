import { addNode, createDocument, makeShapeNode, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { runKnifeCut } from './knifeCommand';

function documentWithRect() {
  let doc = createDocument('Knife command test', true);
  doc = addNode(
    doc,
    makeShapeNode(
      'shape',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Rectangle 1', transform: [1, 0, 0, 1, 0, 0] },
    ),
  );
  return doc;
}

const across = { start: [-20, 50] as const, end: [120, 50] as const };

describe('runKnifeCut', () => {
  it('returns a document, a selection patch, and what to announce', () => {
    const document = documentWithRect();
    const outcome = runKnifeCut(across, { document, selection: ['shape'], selectionRevision: 7 });

    expect(outcome.document).not.toBeNull();
    expect(outcome.document).not.toBe(document);
    expect(outcome.patch).toEqual({
      selection: expect.arrayContaining(['shape']),
      primaryId: 'shape',
      focusedNodeId: 'shape',
      selectionRevision: 8,
      undoLabel: 'Knife Slice',
      redoLabel: 'Redo',
    });
    expect(outcome.patch?.selection).toHaveLength(2);
    expect(outcome.announcement).toBe('Split into 2 objects.');
  });

  it('commits nothing when the cut divides nothing, and says why', () => {
    const document = documentWithRect();
    const outcome = runKnifeCut(
      { start: [-20, 500], end: [120, 500] },
      { document, selection: ['shape'], selectionRevision: 1 },
    );

    // Null document is the signal not to open a transaction at all, which is
    // what keeps an empty cut out of the undo stack.
    expect(outcome.document).toBeNull();
    expect(outcome.patch).toBeNull();
    expect(outcome.announcement).toBe(
      'Nothing was sliced. Drag the cut all the way across an object.',
    );
  });

  it('explains a refused target instead of reporting a generic failure', () => {
    let document = createDocument('Knife command text', true);
    document = addNode(
      document,
      makeTextNode('text', 'Hello', {
        name: 'Headline',
        transform: [1, 0, 0, 1, 0, 0],
        fontSize: 16,
        w: 100,
        h: 40,
      }),
    );

    const outcome = runKnifeCut(
      { start: [-20, 10], end: [120, 10] },
      { document, selection: ['text'], selectionRevision: 1 },
    );

    expect(outcome.document).toBeNull();
    expect(outcome.announcement).toBe(
      'Live text can\'t be sliced. Convert "Headline" to outlines first.',
    );
  });

  it('reports both the cut and the refusal when one object of several is refused', () => {
    let document = documentWithRect();
    document = addNode(
      document,
      makeTextNode('text', 'Hello', {
        name: 'Headline',
        transform: [1, 0, 0, 1, 200, 45],
        fontSize: 16,
        w: 100,
        h: 40,
      }),
    );

    const outcome = runKnifeCut(
      { start: [-20, 50], end: [400, 50] },
      { document, selection: ['shape', 'text'], selectionRevision: 1 },
    );

    expect(outcome.document).not.toBeNull();
    expect(outcome.announcement).toContain('Split into 2 objects.');
    expect(outcome.announcement).toContain('Headline');
  });

  it('counts objects and pieces separately across a multi-object cut', () => {
    let document = documentWithRect();
    document = addNode(
      document,
      makeShapeNode(
        'second',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        { name: 'Rectangle 3', transform: [1, 0, 0, 1, 200, 0] },
      ),
    );

    const outcome = runKnifeCut(
      { start: [-20, 50], end: [400, 50] },
      { document, selection: ['shape', 'second'], selectionRevision: 1 },
    );

    expect(outcome.announcement).toBe('Split 2 objects into 4 pieces.');
  });
});
