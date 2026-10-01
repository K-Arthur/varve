import {
  addChild,
  createDocument,
  type Document,
  makeShapeNode,
  type PatternDefinition,
  patternFill,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyPatternFillFieldChange,
  applyPatternFillPatchToSelection,
  patternFillFieldValue,
} from './patternSelectionFields';

function documentWithPatterns(): {
  document: Document;
  definition: PatternDefinition;
} {
  const base = createDocument('Pattern selection fields');
  const rootId = base.pages?.[0]?.contentRoot as string;
  const first = {
    ...makeShapeNode('pattern-first', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }),
    fills: [
      patternFill('first-tile', {
        definitionId: 'shared-definition',
        imageWidth: 20,
        offsetX: 2,
        rotation: 10,
        gapX: 3,
      }),
    ],
  };
  const second = {
    ...makeShapeNode('pattern-second', { kind: 'rect', x: 60, y: 0, w: 40, h: 40 }),
    fills: [
      patternFill('second-tile', {
        definitionId: 'shared-definition',
        imageWidth: 32,
        offsetX: 12,
        rotation: 30,
        gapX: 8,
      }),
    ],
  };
  const definition: PatternDefinition = {
    id: 'shared-definition',
    name: 'Shared source',
    revision: 1,
    cell: { x: 0, y: 0, width: 16, height: 12 },
    repeat: {
      arrangement: 'grid',
      gapX: 4,
      gapY: 5,
      rowShift: 0,
      mirrorX: false,
      mirrorY: false,
      originX: -2,
      originY: 7,
    },
    source: {
      kind: 'procedural',
      recipe: {
        type: 'checkerboard',
        tileWidth: 16,
        tileHeight: 12,
        color1: '#fff',
        color2: '#000',
        seed: 0,
      },
    },
  };
  let document = addChild(base, rootId, first);
  document = addChild(document, rootId, second);
  document = {
    ...document,
    patternDefinitions: { [definition.id]: definition },
  };
  return { document, definition };
}

describe('multi-selection pattern placement fields', () => {
  it('changes only the named field on every selected fill', () => {
    const { document } = documentWithPatterns();
    const next = applyPatternFillFieldChange(
      document,
      ['pattern-first', 'pattern-second'],
      0,
      'offsetX',
      { type: 'set', value: -4.5 },
    );

    expect(next.nodes['pattern-first']?.fills?.[0]?.pattern).toMatchObject({
      offsetX: -4.5,
      rotation: 10,
      imageWidth: 20,
      gapX: 3,
    });
    expect(next.nodes['pattern-second']?.fills?.[0]?.pattern).toMatchObject({
      offsetX: -4.5,
      rotation: 30,
      imageWidth: 32,
      gapX: 8,
    });
  });

  it('applies a relative gesture delta to each fill’s own current value', () => {
    const { document } = documentWithPatterns();
    const next = applyPatternFillFieldChange(
      document,
      ['pattern-first', 'pattern-second'],
      0,
      'rotation',
      { type: 'delta', delta: 5 },
    );

    expect(next.nodes['pattern-first']?.fills?.[0]?.pattern?.rotation).toBe(15);
    expect(next.nodes['pattern-second']?.fills?.[0]?.pattern?.rotation).toBe(35);
  });

  it('merges an explicit multi-field patch without copying other per-fill values', () => {
    const { document } = documentWithPatterns();
    const next = applyPatternFillPatchToSelection(
      document,
      ['pattern-first', 'pattern-second'],
      0,
      { arrangement: 'brick', gapX: 9 },
    );

    expect(next.nodes['pattern-first']?.fills?.[0]?.pattern).toMatchObject({
      arrangement: 'brick',
      gapX: 9,
      offsetX: 2,
      rotation: 10,
      imageWidth: 20,
    });
    expect(next.nodes['pattern-second']?.fills?.[0]?.pattern).toMatchObject({
      arrangement: 'brick',
      gapX: 9,
      offsetX: 12,
      rotation: 30,
      imageWidth: 32,
    });
  });

  it('reads effective linked-source defaults for mixed-value detection', () => {
    const { document } = documentWithPatterns();
    const firstNode = {
      ...document.nodes['pattern-first']!,
      fills: [patternFill('first-tile', { definitionId: 'shared-definition' })],
    };
    const doc = {
      ...document,
      nodes: { ...document.nodes, [firstNode.id]: firstNode },
    };

    expect(patternFillFieldValue(doc, firstNode.id, 0, 'imageWidth')).toBe(16);
    expect(patternFillFieldValue(doc, firstNode.id, 0, 'offsetX')).toBe(-2);
    expect(patternFillFieldValue(doc, firstNode.id, 0, 'gapX')).toBe(4);
  });

  it('ignores non-pattern slots and refuses non-finite values', () => {
    const { document } = documentWithPatterns();
    const before = applyPatternFillFieldChange(document, ['pattern-first'], 0, 'rotation', {
      type: 'set',
      value: Number.NaN,
    });

    expect(before).toBe(document);
    expect(patternFillFieldValue(document, 'pattern-first', 1, 'rotation')).toBeUndefined();
  });
});
