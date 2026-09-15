import { describe, expect, it } from 'vitest';
import { createIdGenerator, generateId, ID_PREFIXES, nextId } from './ids';

describe('IdGenerator', () => {
  it('creates a generator with all counters at zero', () => {
    const gen = createIdGenerator();
    for (const key of Object.keys(ID_PREFIXES)) {
      expect(gen.counters[key as keyof typeof ID_PREFIXES]).toBe(0);
    }
  });

  it('generateId returns sequential IDs within a namespace', () => {
    const gen = createIdGenerator();
    expect(generateId(gen, 'node')).toBe('n1');
    expect(generateId(gen, 'node')).toBe('n2');
    expect(generateId(gen, 'node')).toBe('n3');
  });

  it('generateId mutates the generator in place', () => {
    const gen = createIdGenerator();
    generateId(gen, 'style');
    expect(gen.counters.style).toBe(1);
  });

  it('IDs from different namespaces use distinct prefixes', () => {
    const gen = createIdGenerator();
    expect(generateId(gen, 'node')).toBe('n1');
    expect(generateId(gen, 'style')).toBe('s1');
    expect(generateId(gen, 'timeline')).toBe('tl1');
    expect(generateId(gen, 'track')).toBe('trk1');
    expect(generateId(gen, 'smTransition')).toBe('trn1');
    expect(generateId(gen, 'variable')).toBe('v1');
  });

  it('nextId returns id and an immutable copy of the generator', () => {
    const gen = createIdGenerator();
    const [id1, gen2] = nextId(gen, 'node');
    expect(id1).toBe('n1');
    expect(gen.counters.node).toBe(0); // original unchanged
    expect(gen2.counters.node).toBe(1);

    const [id2, gen3] = nextId(gen2, 'node');
    expect(id2).toBe('n2');
    expect(gen2.counters.node).toBe(1); // unchanged
    expect(gen3.counters.node).toBe(2);
  });

  it('nextId does not mutate the original generator', () => {
    const gen = createIdGenerator();
    nextId(gen, 'page');
    expect(gen.counters.page).toBe(0);
  });

  it('produces correct IDs for all namespaces', () => {
    const gen = createIdGenerator();
    const expected: Record<string, string> = {
      node: 'n1',
      style: 's1',
      page: 'p1',
      guide: 'g1',
      componentProp: 'prop1',
      variant: 'var1',
      propertySet: 'set1',
      variableCollection: 'col1',
      variableGroup: 'grp1',
      variable: 'v1',
      timeline: 'tl1',
      track: 'trk1',
      keyframe: 'kf1',
      stateMachine: 'sm1',
      smState: 'st1',
      smTransition: 'trn1',
      smInput: 'inp1',
      library: 'lib1',
      booleanResult: 'bool1',
      mask: 'msk1',
      document: 'doc1',
      colorSwatch: 'sw1',
      colorStyle: 'cs1',
      textStyle: 'ts1',
      effectStyle: 'es1',
      layoutStyle: 'ls1',
    };
    for (const [ns, expectedId] of Object.entries(expected)) {
      expect(generateId(gen, ns as keyof typeof ID_PREFIXES)).toBe(expectedId);
    }
  });

  it('sequential IDs increment within the same namespace', () => {
    const gen = createIdGenerator();
    expect(generateId(gen, 'node')).toBe('n1');
    expect(generateId(gen, 'style')).toBe('s1');
    expect(generateId(gen, 'node')).toBe('n2');
    expect(generateId(gen, 'style')).toBe('s2');
  });

  it('createIdGenerator produces independent generators', () => {
    const g1 = createIdGenerator();
    const g2 = createIdGenerator();
    generateId(g1, 'node');
    expect(g1.counters.node).toBe(1);
    expect(g2.counters.node).toBe(0);
  });

  describe('track vs transition prefix distinction (no collision)', () => {
    it('track uses trk prefix', () => {
      const gen = createIdGenerator();
      expect(generateId(gen, 'track')).toBe('trk1');
    });
    it('smTransition uses trn prefix', () => {
      const gen = createIdGenerator();
      expect(generateId(gen, 'smTransition')).toBe('trn1');
    });
  });
});
