import type { Document, Fill, PatternFillData, SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { applyPatternTileImport, capturePatternTileImportTargets } from './patternTileImport';

function pattern(src: string, phase = 0): PatternFillData {
  return { tileSrc: src, spacing: 0, rotation: 0, offsetX: phase };
}

function patternFill(data: PatternFillData): Fill {
  return { type: 'pattern', pattern: data, opacity: 1, blendMode: 'normal', visible: true };
}

function makeDoc(patternA: PatternFillData, patternB: PatternFillData): Document {
  return {
    id: 'doc-pattern-import',
    nodes: {
      first: { id: 'first', kind: 'shape', fills: [patternFill(patternA)] },
      second: { id: 'second', kind: 'shape', fills: [patternFill(patternB)] },
    },
  } as unknown as Document;
}

describe('pattern source imports', () => {
  it('keeps a delayed import on the original nodes and preserves newer placement fields', () => {
    const original = makeDoc(pattern('first.png', 2), pattern('other.png', -3));
    const targets = capturePatternTileImportTargets(original, ['first'], 0);
    const changedWhilePickerWasOpen = {
      ...original,
      nodes: {
        ...original.nodes,
        first: {
          ...original.nodes.first!,
          fills: [patternFill({ ...pattern('first.png', 2), offsetX: 19, rotation: 27 })],
        } as SceneNode,
      },
    };

    const result = applyPatternTileImport(
      changedWhilePickerWasOpen,
      0,
      targets,
      'data:image/png;base64,NEW',
    );

    expect(result.updatedCount).toBe(1);
    expect(result.document.nodes.first?.fills?.[0]?.pattern).toMatchObject({
      tileSrc: 'data:image/png;base64,NEW',
      offsetX: 19,
      rotation: 27,
    });
    expect(result.document.nodes.second?.fills?.[0]?.pattern?.tileSrc).toBe('other.png');
  });

  it('does not overwrite a source changed while the picker was open', () => {
    const original = makeDoc(pattern('before.png'), pattern('other.png'));
    const targets = capturePatternTileImportTargets(original, ['first'], 0);
    const newerDocument = {
      ...original,
      nodes: {
        ...original.nodes,
        first: {
          ...original.nodes.first!,
          fills: [patternFill(pattern('newer.png'))],
        } as SceneNode,
      },
    };

    const result = applyPatternTileImport(newerDocument, 0, targets, 'data:image/png;base64,STALE');

    expect(result.updatedCount).toBe(0);
    expect(result.document).toBe(newerDocument);
    expect(result.document.nodes.first?.fills?.[0]?.pattern?.tileSrc).toBe('newer.png');
  });

  it('does not include linked patterns or another selected node in the import targets', () => {
    const shared = { ...pattern('shared.png'), definitionId: 'shared-id' };
    const original = makeDoc(pattern('inline.png'), shared);
    const targets = capturePatternTileImportTargets(original, ['first', 'second'], 0);

    expect(targets.map((target) => target.nodeId)).toEqual(['first']);
  });
});
