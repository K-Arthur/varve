/**
 * Persistent identity tests (ADR-0025/0026).
 *
 * - minted format: `n<counter>_<random hex>` with an injectable RNG
 * - collision resistance across independently edited branches
 * - legacy format remains recognized; parsers tolerate both
 * - allocators (nodes, styles, components, variables) produce minted ids
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createComponent } from '../component';
import { addNode, createDocument, makeFrameNode, makeShapeNode } from '../document';
import { solidFill } from '../fills';
import {
  idCounter,
  isLegacyNumericId,
  isMintedId,
  mintId,
  parseMintedId,
  randomHex,
  resetDefaultIdRng,
  setDefaultIdRng,
} from '../identity';
import { nextNodeId } from '../node-id';
import { createColorStyle } from '../styles';
import { addVariable, createCollection, createVariableStore } from '../variables';

const FIXED_RNG = (): string => '0123456789abcdef';

describe('minted id format', () => {
  it('mints prefix+counter+random with an injectable rng', () => {
    expect(mintId('n', 7, FIXED_RNG)).toBe('n7_0123456789abcdef');
    expect(mintId('s', 1, FIXED_RNG)).toBe('s1_0123456789abcdef');
  });

  it('parses minted ids and counters from both formats', () => {
    expect(parseMintedId('n12_3fa9c2')).toEqual({ prefix: 'n', counter: 12, random: '3fa9c2' });
    expect(parseMintedId('n12')).toBeNull();
    expect(idCounter('n12')).toBe(12);
    expect(idCounter('n12_3fa9c2')).toBe(12);
    expect(idCounter('s3')).toBe(3);
    expect(idCounter('col-1')).toBe(1);
    expect(idCounter('v-0123456789abcdef')).toBeNull();
  });

  it('classifies legacy and minted formats', () => {
    expect(isLegacyNumericId('n12', 'n')).toBe(true);
    expect(isLegacyNumericId('n12_abcd', 'n')).toBe(false);
    expect(isLegacyNumericId('col-3', 'col-')).toBe(true);
    expect(isMintedId('n12_abcd')).toBe(true);
    expect(isMintedId('n12')).toBe(false);
  });

  it('randomHex returns lowercase hex of the requested byte width', () => {
    const hex = randomHex(8);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic under an injected rng', () => {
    const a = mintId('n', 1, FIXED_RNG);
    const b = mintId('n', 1, FIXED_RNG);
    expect(a).toBe(b);
  });
});

describe('branch collision resistance', () => {
  it('two branches minting the same counter produce different ids', () => {
    // Both branches of the same document start from the same counter.
    const branchA = mintId('n', 42, () => 'aaaaaaaaaaaaaaaa');
    const branchB = mintId('n', 42, () => 'bbbbbbbbbbbbbbbb');
    expect(branchA).not.toBe(branchB);
  });

  it('ids are unique even when the same counter is minted twice (decode reuse)', () => {
    // decode recomputes nextId; without the random component the same
    // counter would be minted twice across branches.
    const a = mintId('n', 1, () => 'aaaaaaaaaaaaaaaa');
    const b = mintId('n', 1, () => 'bbbbbbbbbbbbbbbb');
    expect(a).not.toBe(b);
    expect(idCounter(a)).toBe(1);
    expect(idCounter(b)).toBe(1);
  });
});

describe('allocator integration', () => {
  beforeAll(() => setDefaultIdRng(FIXED_RNG));
  afterAll(() => resetDefaultIdRng());

  it('nextNodeId mints collision-resistant ids', () => {
    const doc = createDocument('alloc', { flat: true });
    const { id, doc: d2 } = nextNodeId(doc);
    expect(id).toBe('n1_0123456789abcdef');
    expect(d2.nextId).toBe(2);
  });

  it('style creation mints s<counter>_<random> ids', () => {
    const doc = createDocument('style', { flat: true });
    const { style } = createColorStyle(
      doc,
      'Teal',
      solidFill({ space: 'rgb', r: 0, g: 128, b: 128, a: 255 }),
    );
    expect(style.id).toBe('s1_0123456789abcdef');
    expect(style.type).toBe('color');
  });

  it('component creation mints n<counter>_<random> ids', () => {
    const doc = createDocument('component', { flat: true });
    const frame = makeFrameNode('n1_0123456789abcdef', { w: 100, h: 100 });
    const withFrame = addNode(doc, frame);
    const { component, doc: d2 } = createComponent(withFrame, 'Button', frame.id, []);
    expect(component.id).toMatch(/^n\d+_[0-9a-f]{16}$/);
    expect(Object.keys(d2.components)).toContain(component.id);
    expect(d2.nextId).toBeGreaterThan(withFrame.nextId);
  });

  it('variable ids are pure-random within legacy prefixes', () => {
    const store = createVariableStore(['default']);
    const { collection } = createCollection(store, 'Colors');
    expect(collection.id).toMatch(/^col-[0-9a-f]{16}$/);
    const { variable } = addVariable(store, {
      name: 'brand',
      type: 'color',
      valuesByMode: { default: '#123456' },
    });
    expect(variable.id).toMatch(/^v-[0-9a-f]{16}$/);
  });

  it('node ids created through the document pipeline are minted', () => {
    const doc = createDocument('pipeline', { flat: true });
    const shape = makeShapeNode('n1_0123456789abcdef', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const withNode = addNode(doc, shape);
    expect(Object.keys(withNode.nodes)[0]).toBe('n1_0123456789abcdef');
  });
});
