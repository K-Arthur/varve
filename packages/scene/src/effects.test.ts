import { describe, expect, it } from 'vitest';
import { createDocument, makeShapeNode } from './document';
import { normalizeDocumentEffects, normalizeEffectParams } from './effects';
import type { Effect } from './types';

function shadow(overrides: Partial<Record<string, unknown>> = {}): Effect {
  return {
    type: 'dropShadow',
    x: 2,
    y: 3,
    blur: 8,
    spread: 1,
    color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
    opacity: 0.5,
    blendMode: 'normal',
    visible: true,
    ...overrides,
  };
}

describe('normalizeEffectParams', () => {
  it('assigns a stable id to an effect without one', () => {
    const normalized = normalizeEffectParams(shadow());
    expect(normalized.id).toBeTypeOf('string');
    expect(normalized.id?.length).toBeGreaterThan(0);
  });

  it('keeps an existing id unchanged', () => {
    const normalized = normalizeEffectParams(shadow({ id: 'fx-1' }));
    expect(normalized.id).toBe('fx-1');
  });

  it('clamps NaN blur to zero instead of producing a NaN canvas', () => {
    const normalized = normalizeEffectParams(shadow({ blur: Number.NaN }));
    if (normalized.type === 'dropShadow') expect(normalized.blur).toBe(0);
  });

  it('clamps non-finite offsets to the safe fallback and huge values to the cap', () => {
    const inf = normalizeEffectParams(shadow({ x: Number.POSITIVE_INFINITY }));
    if (inf.type === 'dropShadow') expect(inf.x).toBe(0);
    const huge = normalizeEffectParams(shadow({ x: 1e12 }));
    if (huge.type === 'dropShadow') expect(huge.x).toBe(4096);
  });

  it('clamps opacity into 0..1', () => {
    const normalized = normalizeEffectParams(shadow({ opacity: 5 }));
    if (normalized.type === 'dropShadow') expect(normalized.opacity).toBe(1);
  });

  it('clamps extreme finite values even when the effect already has an id', () => {
    const normalized = normalizeEffectParams(shadow({ id: 'fx-1', blur: 1e12, x: -1e12 }));
    if (normalized.type !== 'dropShadow') throw new Error('expected drop shadow');
    expect(normalized.id).toBe('fx-1');
    expect(normalized.blur).toBe(4096);
    expect(normalized.x).toBe(-4096);
  });

  it('normalizes nested chromatic offsets and intensity', () => {
    const effect = {
      type: 'chromaticAberration',
      id: 'chromatic-1',
      offsets: { redX: Number.POSITIVE_INFINITY, blueX: -1e9 },
      intensity: Number.NaN,
      blendMode: 'normal',
      opacity: 4,
      visible: true,
    } as unknown as Effect;

    const normalized = normalizeEffectParams(effect);
    if (normalized.type !== 'chromaticAberration') throw new Error('expected chromatic effect');
    expect(normalized.offsets).toEqual({
      redX: 3,
      redY: 0,
      greenX: 0,
      greenY: 0,
      blueX: -4096,
      blueY: 0,
    });
    expect(normalized.intensity).toBe(1);
    expect(normalized.opacity).toBe(1);
  });

  it('bounds glitch loop counts, spacing, intensities, and enum values', () => {
    const effect = {
      type: 'glitch',
      id: 'glitch-1',
      seed: Number.POSITIVE_INFINITY,
      strength: -4,
      density: 8,
      sliceHeight: 0,
      blockCount: Number.POSITIVE_INFINITY,
      blockSize: 1e12,
      blockStrength: Number.NaN,
      noiseIntensity: -1,
      scanlineIntensity: 2,
      scanlineSpacing: 0,
      direction: 'diagonal',
      channelShift: null,
      channelShiftMode: 'random',
      blendMode: 'normal',
      opacity: Number.NaN,
      visible: true,
    } as unknown as Effect;

    const normalized = normalizeEffectParams(effect);
    if (normalized.type !== 'glitch') throw new Error('expected glitch effect');
    expect(normalized).toMatchObject({
      id: 'glitch-1',
      seed: 42,
      strength: 0,
      density: 1,
      sliceHeight: 1,
      blockCount: 5,
      blockSize: 4096,
      blockStrength: 10,
      noiseIntensity: 0,
      scanlineIntensity: 1,
      scanlineSpacing: 1,
      direction: 'horizontal',
      channelShiftMode: 'static',
      opacity: 1,
    });
    expect(normalized.channelShift).toEqual({
      redX: 0,
      redY: 0,
      greenX: 0,
      greenY: 0,
      blueX: 0,
      blueY: 0,
    });
  });

  it('does not touch malformed unknown effect types beyond assigning an id', () => {
    const unknown = { type: 'somethingNew', visible: true } as unknown as Effect;
    const normalized = normalizeEffectParams(unknown);
    expect(normalized.id).toBeTypeOf('string');
    expect((normalized as { type: string }).type).toBe('somethingNew');
  });
});

describe('normalizeDocumentEffects', () => {
  it('assigns ids to every effect across all nodes', () => {
    let doc = createDocument('Doc');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { effects: [shadow(), shadow({ id: 'kept' })] },
    );
    doc = { ...doc, rootChildren: ['n1'], nodes: { ...doc.nodes, n1: node } };
    const normalized = normalizeDocumentEffects(doc);
    const effects = (normalized.nodes.n1 as { effects: Effect[] }).effects;
    expect(effects[0]?.id).toBe('fx-n1-1');
    expect(effects[1]?.id).toBe('kept');
  });

  it('assigns legacy ids deterministically and idempotently', () => {
    let doc = createDocument('Doc');
    const node = makeShapeNode(
      'legacy-node',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { effects: [shadow(), shadow()] },
    );
    doc = { ...doc, rootChildren: ['legacy-node'], nodes: { ...doc.nodes, 'legacy-node': node } };
    const first = normalizeDocumentEffects(doc);
    const second = normalizeDocumentEffects(first);
    const firstIds = (first.nodes['legacy-node'] as { effects: Effect[] }).effects.map((e) => e.id);
    const secondIds = (second.nodes['legacy-node'] as { effects: Effect[] }).effects.map(
      (e) => e.id,
    );
    expect(firstIds).toEqual(['fx-legacy-node-1', 'fx-legacy-node-2']);
    expect(secondIds).toEqual(firstIds);
  });

  it('replaces duplicate ids within a node without changing the first effect', () => {
    let doc = createDocument('Doc');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { effects: [shadow({ id: 'duplicate' }), shadow({ id: 'duplicate' })] },
    );
    doc = { ...doc, rootChildren: ['n1'], nodes: { ...doc.nodes, n1: node } };
    const normalized = normalizeDocumentEffects(doc);
    const effects = (normalized.nodes.n1 as { effects: Effect[] }).effects;
    expect(effects[0]?.id).toBe('duplicate');
    expect(effects[1]?.id).not.toBe('duplicate');
    expect(effects[1]?.id).toBeTypeOf('string');
  });

  it('is a no-op (same reference) when every effect already has an id', () => {
    let doc = createDocument('Doc');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { effects: [shadow({ id: 'a' }), shadow({ id: 'b' })] },
    );
    doc = { ...doc, rootChildren: ['n1'], nodes: { ...doc.nodes, n1: node } };
    const normalized = normalizeDocumentEffects(doc);
    expect(normalized).toBe(doc);
  });
});
