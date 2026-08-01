import type { SceneNode as EngineNode } from '@strata/engine';
import { describe, expect, it } from 'vitest';
import { EngineNodeMemo } from './engineNodeMemo';

const engineNode = (id: string): EngineNode =>
  ({ id, name: id, transform: [1, 0, 0, 1, 0, 0] }) as unknown as EngineNode;

/** Frame-level inputs that are constant unless a test varies them. */
const PAINTS = { p: 1 };
const STYLES = { s: 1 };
const MASKS = { m: 1 };

function freshMemo(max?: number): EngineNodeMemo {
  const memo = new EngineNodeMemo(max);
  memo.beginFrame(PAINTS, MASKS, STYLES, '');
  return memo;
}

describe('EngineNodeMemo', () => {
  it('serves a hit when the node and world transform keep identity', () => {
    const memo = freshMemo();
    const src = { id: 'a' };
    const world = [1, 0, 0, 1, 0, 0];
    const built = engineNode('a');

    expect(memo.get('a', src, world)).toBeUndefined();
    memo.set('a', src, world, built);

    memo.beginFrame(PAINTS, MASKS, STYLES, '');
    expect(memo.get('a', src, world)).toBe(built);
    expect(memo.hits).toBe(1);
    expect(memo.computes).toBe(1);
  });

  it('misses when the scene node reference changes (the edited-node case)', () => {
    const memo = freshMemo();
    const world = [1, 0, 0, 1, 0, 0];
    memo.set('a', { id: 'a' }, world, engineNode('a'));

    memo.beginFrame(PAINTS, MASKS, STYLES, '');
    // A document edit replaces the node object; structural sharing keeps every
    // other node's reference, which is what makes the memo worthwhile.
    expect(memo.get('a', { id: 'a' }, world)).toBeUndefined();
  });

  it('misses when only the world transform changes (dragged node)', () => {
    const memo = freshMemo();
    const src = { id: 'a' };
    memo.set('a', src, [1, 0, 0, 1, 0, 0], engineNode('a'));

    memo.beginFrame(PAINTS, MASKS, STYLES, '');
    expect(memo.get('a', src, [1, 0, 0, 1, 5, 5])).toBeUndefined();
  });

  it('drops everything when the style table changes', () => {
    const memo = freshMemo();
    const src = { id: 'a' };
    const world = [1, 0, 0, 1, 0, 0];
    memo.set('a', src, world, engineNode('a'));

    memo.beginFrame(PAINTS, MASKS, { s: 2 }, '');
    expect(memo.get('a', src, world)).toBeUndefined();
  });

  it('keeps hitting for a styled node while only the override object identity churns', () => {
    // resolveAllStyles allocates a fresh override object per call and is
    // memoized on the document, so it changes identity on every drag frame.
    // The override is a pure function of (node, doc.styles), both of which are
    // already in the key — so a styled node must still hit. Keying on the
    // override object itself would make every styled node miss every frame.
    const memo = freshMemo();
    const src = { id: 'a', styleId: 's1' };
    const world = [1, 0, 0, 1, 0, 0];
    memo.set('a', src, world, engineNode('a'));

    for (let frame = 0; frame < 3; frame++) {
      memo.beginFrame(PAINTS, MASKS, STYLES, '');
      expect(memo.get('a', src, world)).toBeDefined();
    }
    expect(memo.hits).toBe(3);
    expect(memo.computes).toBe(1);
  });

  it('drops everything when shared paints change', () => {
    const memo = freshMemo();
    const src = { id: 'a' };
    const world = [1, 0, 0, 1, 0, 0];
    memo.set('a', src, world, engineNode('a'));

    memo.beginFrame({ p: 2 }, MASKS, STYLES, '');
    expect(memo.get('a', src, world)).toBeUndefined();
  });

  it('drops everything when raster mask assets change', () => {
    const memo = freshMemo();
    const src = { id: 'a' };
    const world = [1, 0, 0, 1, 0, 0];
    memo.set('a', src, world, engineNode('a'));

    memo.beginFrame(PAINTS, { m: 2 }, STYLES, '');
    expect(memo.get('a', src, world)).toBeUndefined();
  });

  it('drops everything when the show-original-background node changes', () => {
    const memo = freshMemo();
    const src = { id: 'a' };
    const world = [1, 0, 0, 1, 0, 0];
    memo.set('a', src, world, engineNode('a'));

    memo.beginFrame(PAINTS, MASKS, STYLES, 'node-7');
    expect(memo.get('a', src, world)).toBeUndefined();
  });

  it('treats the first frame as a change even when inputs are undefined', () => {
    // A bare `undefined` paints/masks document must not collide with the
    // pre-initialisation state and serve entries from a previous document.
    const memo = new EngineNodeMemo();
    const src = { id: 'a' };
    const world = [1, 0, 0, 1, 0, 0];
    memo.beginFrame(undefined, undefined, undefined, '');
    memo.set('a', src, world, engineNode('a'));
    memo.beginFrame(undefined, undefined, undefined, '');
    expect(memo.get('a', src, world)).toBeDefined();
  });

  it('invalidate(id) removes only that node', () => {
    const memo = freshMemo();
    const world = [1, 0, 0, 1, 0, 0];
    const a = { id: 'a' };
    const b = { id: 'b' };
    memo.set('a', a, world, engineNode('a'));
    memo.set('b', b, world, engineNode('b'));

    memo.invalidate('a');
    memo.beginFrame(PAINTS, MASKS, STYLES, '');
    expect(memo.get('a', a, world)).toBeUndefined();
    expect(memo.get('b', b, world)).toBeDefined();
  });

  it('is bounded: never retains more than maxEntries', () => {
    const memo = freshMemo(3);
    const world = [1, 0, 0, 1, 0, 0];
    for (let i = 0; i < 50; i++) {
      memo.set(`n${i}`, { id: `n${i}` }, world, engineNode(`n${i}`));
    }
    expect(memo.size).toBe(3);
    expect(memo.capacity).toBe(3);
  });

  it('evicts in insertion order when over capacity', () => {
    const memo = freshMemo(2);
    const world = [1, 0, 0, 1, 0, 0];
    const a = { id: 'a' };
    const c = { id: 'c' };
    memo.set('a', a, world, engineNode('a'));
    memo.set('b', { id: 'b' }, world, engineNode('b'));
    memo.set('c', c, world, engineNode('c'));

    memo.beginFrame(PAINTS, MASKS, STYLES, '');
    expect(memo.get('a', a, world)).toBeUndefined();
    expect(memo.get('c', c, world)).toBeDefined();
  });

  it('re-setting an existing id does not grow the map past capacity', () => {
    const memo = freshMemo(2);
    const world = [1, 0, 0, 1, 0, 0];
    memo.set('a', { id: 'a' }, world, engineNode('a'));
    memo.set('a', { id: 'a2' }, world, engineNode('a'));
    memo.set('b', { id: 'b' }, world, engineNode('b'));
    expect(memo.size).toBe(2);
  });

  it('setMaxEntries shrinks an over-full memo immediately', () => {
    const memo = freshMemo(10);
    const world = [1, 0, 0, 1, 0, 0];
    for (let i = 0; i < 10; i++) {
      memo.set(`n${i}`, { id: `n${i}` }, world, engineNode(`n${i}`));
    }
    expect(memo.size).toBe(10);
    memo.setMaxEntries(4);
    expect(memo.size).toBe(4);
  });

  it('clear() forces the next beginFrame to be treated as changed', () => {
    const memo = freshMemo();
    const src = { id: 'a' };
    const world = [1, 0, 0, 1, 0, 0];
    memo.set('a', src, world, engineNode('a'));
    memo.clear();
    memo.beginFrame(PAINTS, MASKS, STYLES, '');
    expect(memo.get('a', src, world)).toBeUndefined();
  });

  it('counts one compute per conversion and one hit per reuse', () => {
    const memo = freshMemo();
    const world = [1, 0, 0, 1, 0, 0];
    const nodes = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}` }));
    for (const n of nodes) memo.set(n.id, n, world, engineNode(n.id));
    expect(memo.computes).toBe(5);

    // Next frame: one node edited, four unchanged — the drag steady state.
    memo.beginFrame(PAINTS, MASKS, STYLES, '');
    let hits = 0;
    for (const n of nodes) {
      const edited = n.id === 'n0' ? { id: 'n0' } : n;
      if (memo.get(n.id, edited, world)) hits++;
    }
    expect(hits).toBe(4);
    expect(memo.hits).toBe(4);
    expect(memo.computes).toBe(5);
  });
});
