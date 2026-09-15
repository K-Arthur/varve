/**
 * Reference graph tests: cycles, missing targets, group refs, invalid
 * pointers, type mismatches, chain depth, alias dependants.
 */
import { describe, expect, it } from 'vitest';

import { parseFormatDocument } from '../parse';
import { aliasDependants, buildReferenceGraph, referenceTargets } from '../refGraph';

function graph(text: string) {
  const doc = parseFormatDocument(text, { sourceFileId: 't' });
  return { doc, graph: buildReferenceGraph(doc) };
}

function codes(diagnostics: { code: string }[]): string[] {
  return diagnostics.map((d) => d.code);
}

describe('reference graph', () => {
  it('builds outgoing and incoming edges for curly aliases', () => {
    const { graph: g } = graph(
      '{"base": {"$type": "number", "$value": 1}, "alias": {"$type": "number", "$value": "{base}"}}',
    );
    expect(g.outgoing.get('alias')?.[0]?.to).toBe('base');
    expect(g.incoming.get('base')?.[0]?.from).toBe('alias');
    expect(g.diagnostics).toEqual([]);
  });

  it('detects direct and indirect cycles', () => {
    const direct = graph('{"a": {"$value": "{b}"}, "b": {"$value": "{a}"}}');
    expect(direct.graph.cycleMembers.has('a')).toBe(true);
    expect(direct.graph.cycleMembers.has('b')).toBe(true);
    expect(codes(direct.graph.diagnostics)).toContain('ref.cycle');

    const chain = graph('{"a": {"$value": "{b}"}, "b": {"$value": "{c}"}, "c": {"$value": "{a}"}}');
    expect([...chain.graph.cycleMembers].sort()).toEqual(['a', 'b', 'c']);
  });

  it('detects self references', () => {
    const { graph: g } = graph('{"a": {"$value": "{a}"}}');
    expect(g.cycleMembers.has('a')).toBe(true);
  });

  it('reports missing targets', () => {
    const { graph: g } = graph('{"a": {"$value": "{missing.token}"}}');
    expect(codes(g.diagnostics)).toContain('ref.missing-target');
  });

  it('reports references to groups', () => {
    const { graph: g } = graph('{"g": {"$type": "number"}, "a": {"$value": "{g}"}}');
    expect(codes(g.diagnostics)).toContain('ref.targets-group');
  });

  it('resolves JSON Pointer references against the document', () => {
    const { graph: g } = graph(
      '{"base": {"$type": "color", "$value": {"colorSpace": "srgb", "components": [0.2, 0.4, 0.9]}}, "hue": {"$type": "number", "$value": {"$ref": "#/base/$value/components/0"}}}',
    );
    expect(g.diagnostics).toEqual([]);
    const edge = g.outgoing.get('hue')?.[0];
    expect(edge?.toPointer).toBe('#/base/$value/components/0');
    expect(edge?.to).toBe('base');
  });

  it('reports invalid JSON Pointers', () => {
    const { graph: g } = graph('{"a": {"$value": {"$ref": "#/nope/1"}}}');
    expect(codes(g.diagnostics)).toContain('ref.invalid-pointer');
  });

  it('warns on type mismatches for whole-token aliases', () => {
    const { graph: g } = graph(
      '{"base": {"$type": "number", "$value": 1}, "alias": {"$type": "color", "$value": "{base}"}}',
    );
    expect(codes(g.diagnostics)).toContain('ref.type-mismatch');
  });

  it('does not flag type mismatch for property-level pointers', () => {
    const { graph: g } = graph(
      '{"base": {"$type": "dimension", "$value": {"value": 8, "unit": "px"}}, "n": {"$type": "number", "$value": {"$ref": "#/base/$value/value"}}}',
    );
    expect(g.diagnostics).toEqual([]);
  });

  it('computes alias dependants transitively', () => {
    const { graph: g } = graph(
      '{"base": {"$type": "number", "$value": 1}, "b": {"$type": "number", "$value": "{base}"}, "c": {"$type": "number", "$value": "{b}"}}',
    );
    expect(aliasDependants(g, 'base')).toEqual(new Set(['b', 'c']));
    expect(aliasDependants(g, 'b')).toEqual(new Set(['c']));
  });

  it('computes reference targets transitively', () => {
    const { graph: g } = graph(
      '{"base": {"$type": "number", "$value": 1}, "b": {"$type": "number", "$value": "{base}"}, "c": {"$type": "number", "$value": "{b}"}}',
    );
    expect(referenceTargets(g, 'c')).toEqual(new Set(['b', 'base']));
  });

  it('bounded chain depth for deep alias chains', () => {
    const chain = Array.from(
      { length: 30 },
      (_, i) => `"t${i}": {"$type": "number", "$value": ${i === 29 ? 1 : `"{t${i + 1}}"`}}`,
    ).join(',');
    const { graph: g } = graph(`{${chain}}`);
    expect(g.maxChainDepth).toBe(30);
    expect(codes(g.diagnostics)).not.toContain('ref.cycle');
  });
});
