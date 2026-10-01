import {
  addNode,
  createDocument,
  createPatternDefinitionFromSelection,
  makeShapeNode,
  patternFill,
  patternFillForDefinition,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { countPatternUses } from './patternUsage';

describe('countPatternUses', () => {
  it('counts each matching fill on document objects', () => {
    const first = makeShapeNode('first', { kind: 'rect', x: 0, y: 0, w: 12, h: 12 });
    const second = makeShapeNode('second', { kind: 'rect', x: 20, y: 0, w: 12, h: 12 });
    const base = addNode(addNode(createDocument('Pattern uses', true), first), second);
    const created = createPatternDefinitionFromSelection(base, [first.id], {
      id: 'pattern',
      name: 'Pattern',
    });
    const pattern = patternFill(
      'data:image/png;base64,AA==',
      patternFillForDefinition(created.definition, {}, 'data:image/png;base64,AA=='),
    );
    const withFills = {
      ...created.document,
      nodes: {
        ...created.document.nodes,
        [first.id]: {
          ...first,
          fills: [pattern, pattern],
        },
        [second.id]: {
          ...second,
          fills: [pattern],
        },
      },
    };

    expect(countPatternUses(withFills, 'pattern')).toBe(3);
  });

  it('counts a nested source and its dependency metadata as one use', () => {
    const source = makeShapeNode('source', { kind: 'rect', x: 0, y: 0, w: 16, h: 16 });
    const base = addNode(createDocument('Nested pattern', true), source);
    const parent = createPatternDefinitionFromSelection(base, [source.id], {
      id: 'shared-source',
      name: 'Shared source',
    });
    const artwork = makeShapeNode('nested use', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
    const artworkWithFill = {
      ...artwork,
      fills: [
        patternFill(
          'data:image/png;base64,AA==',
          patternFillForDefinition(parent.definition, {}, 'data:image/png;base64,AA=='),
        ),
      ],
    };
    const withArtwork = addNode(parent.document, artworkWithFill);
    const nested = createPatternDefinitionFromSelection(withArtwork, [artwork.id], {
      id: 'nested-definition',
      name: 'Nested definition',
    });

    expect(nested.definition.dependencyPatternIds).toContain(parent.definition.id);
    expect(countPatternUses(nested.document, parent.definition.id)).toBe(2);
  });
});
