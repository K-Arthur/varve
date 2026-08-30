import { makeAdjustment } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { createDocument, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';
import { appendEffectLook, createEffectLook, normalizeEffectLook } from './effectLooks';
import { duplicateEffect, moveEffect, removeEffect, resetEffect } from './effectStack';

describe('Effect Studio Looks and stack operations', () => {
  it('creates a portable Look and applies it with fresh effect identities', () => {
    const source = [makeAdjustment('source-brightness', 'brightness', { value: 20 })];
    const look = createEffectLook('look-warm', 'Warm lift', source);
    const applied = appendEffectLook(
      source,
      look,
      (() => {
        let id = 0;
        return () => `applied-${++id}`;
      })(),
    );

    expect(look.schemaVersion).toBe(1);
    expect(look.effects[0]).toMatchObject({ id: 'source-brightness', value: 20 });
    expect(applied.map((effect) => effect.id)).toEqual(['source-brightness', 'applied-1']);
    expect(applied[1]).not.toBe(look.effects[0]);
  });

  it('normalizes malformed Look values without allowing invalid effect numbers', () => {
    const result = normalizeEffectLook(
      {
        id: 'look-1',
        name: '  Test look  ',
        effects: [
          { kind: 'futureEffect', parameters: { seed: 2 } },
          { kind: 'brightness', value: Number.POSITIVE_INFINITY },
        ],
      },
      'import',
    );

    expect(result.look).toMatchObject({ id: 'look-1', name: 'Test look', schemaVersion: 1 });
    expect(result.unknownEffects).toBe(1);
    expect(result.look?.effects).toHaveLength(2);
    expect(result.look?.effects[1]).toMatchObject({ kind: 'brightness', value: 0 });
  });

  it('round-trips document-local Looks and preserved unknown effects', () => {
    const doc = createDocument('Looks', true);
    const look = createEffectLook('look-1', 'Contrast recipe', [
      makeAdjustment('contrast-1', 'contrast', { value: 15 }),
    ]);
    const withLook = {
      ...doc,
      effectLooks: [look],
      nodes: {
        ...doc.nodes,
        unknown: {
          ...makeShapeNode('unknown', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
          smartFilters: [
            { kind: 'futureEffect', data: { keep: true } },
          ] as unknown as import('@varve/engine').Adjustment[],
        },
      },
      rootChildren: ['unknown'],
    } as typeof doc;
    const decoded = DocumentCodec.decode(DocumentCodec.encode(withLook));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.effectLooks?.[0]?.name).toBe('Contrast recipe');
    expect(decoded.document.nodes.unknown?.smartFilters?.[0]).toMatchObject({
      kind: 'futureEffect',
      data: { keep: true },
      visible: false,
    });
  });

  it('keeps reorder, duplicate, remove, and reset pure and reversible', () => {
    const first = makeAdjustment('first', 'brightness', { value: 10 });
    const second = makeAdjustment('second', 'contrast', { value: 20 });
    const stack = [first, second];
    expect(moveEffect(stack, 'second', 0).map((effect) => effect.id)).toEqual(['second', 'first']);
    expect(duplicateEffect(stack, 'first', () => 'copy').map((effect) => effect.id)).toEqual([
      'first',
      'copy',
      'second',
    ]);
    expect(removeEffect(stack, 'first').map((effect) => effect.id)).toEqual(['second']);
    expect(resetEffect(first)).toMatchObject({ id: 'first', kind: 'brightness', value: 0 });
    expect(stack.map((effect) => effect.id)).toEqual(['first', 'second']);
  });
});
