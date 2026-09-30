/**
 * Regression suite for find/replace correctness and safety.
 *
 * Each block pins a defect that was reproduced against the pre-repair
 * implementation. The failure mode is named in the test title so a future
 * regression is legible without re-reading the whole file.
 */

import {
  addChild,
  addNode,
  createDocument,
  type GroupNode,
  type RichText,
  type TextNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { buildComparisonProjection, comparisonRangeToOriginal } from './projection';
import { applyReplacementPlan, planReplacements, replaceAll, replaceSingle } from './replace';
import { searchInDocument, searchSpec } from './search';
import type { SearchSpec } from './types';
import { DEFAULT_SEARCH_OPTIONS } from './types';

function textNode(id: string, overrides: Partial<TextNode> = {}): TextNode {
  return {
    id,
    kind: 'text',
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
    text: '',
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fontSize: 16,
    strokes: [],
    effects: [],
    ...overrides,
  };
}

function docWith(text: string, richText?: RichText) {
  return addNode(createDocument('regression', true), textNode('text-1', { text, richText }));
}

/** A document whose only text node is nested inside one group. */
function groupedChild(childText: string, groupOverrides: Partial<GroupNode> = {}) {
  let doc = createDocument('regression', true);
  doc = addNode(doc, textNode('child', { text: childText }));
  const group: GroupNode = {
    id: 'group-1',
    kind: 'group',
    name: 'Group',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
    transform: [1, 0, 0, 1, 0, 0],
    children: [],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    effects: [],
    ...groupOverrides,
  };
  doc = addNode(doc, group);
  return addChild(doc, 'group-1', doc.nodes.child as TextNode);
}

function spec(partial: Partial<SearchSpec> = {}): SearchSpec {
  return {
    id: 'spec-1',
    revision: 0,
    query: '',
    options: { ...DEFAULT_SEARCH_OPTIONS },
    scope: 'document',
    selection: [],
    excludeInstances: false,
    excludeLocked: false,
    excludeHidden: false,
    ...partial,
  };
}

function find(doc: ReturnType<typeof docWith>, query: string, options = {}) {
  return searchInDocument(
    doc,
    query,
    { ...DEFAULT_SEARCH_OPTIONS, ...options },
    'document',
    [],
    false,
    false,
    false,
  ).results;
}

function textOf(doc: { nodes: Record<string, unknown> }, id = 'text-1'): string {
  return (doc.nodes[id] as TextNode).text;
}

describe('projection: normalized comparison maps back to original offsets', () => {
  it('maps a match after a decomposed cluster to the original offset', () => {
    const options = { ...DEFAULT_SEARCH_OPTIONS, matchDiacritics: true, caseSensitive: true };
    const projection = buildComparisonProjection('cafe\u0301 x', options);
    expect(projection.comparison).toBe('café x');
    const at = projection.comparison.indexOf('x');
    const original = comparisonRangeToOriginal(projection, at, at + 1);
    expect('cafe\u0301 x'.slice(original.start, original.end)).toBe('x');
  });

  it('strips diacritics without moving the original offset', () => {
    const projection = buildComparisonProjection('cafe\u0301 x', DEFAULT_SEARCH_OPTIONS);
    expect(projection.comparison).toBe('cafe x');
    const at = projection.comparison.indexOf('x');
    const original = comparisonRangeToOriginal(projection, at, at + 1);
    expect('cafe\u0301 x'.slice(original.start, original.end)).toBe('x');
  });

  it('never splits a grapheme when a folded cluster changes length', () => {
    // 'İ'.toLowerCase() is two code units ('i' + combining dot).
    const projection = buildComparisonProjection('İ!', DEFAULT_SEARCH_OPTIONS);
    const at = projection.comparison.indexOf('!');
    const original = comparisonRangeToOriginal(projection, at, at + 1);
    expect('İ!'.slice(original.start, original.end)).toBe('!');
  });
});

describe('unicode offsets: matches apply to the authored text', () => {
  it('reports the original offset for a match after a decomposed sequence', () => {
    const results = find(docWith('cafe\u0301 x'), 'x');
    expect(results).toHaveLength(1);
    expect(results[0]?.flatStart).toBe(6);
  });

  it('does not corrupt a decomposed sequence when replacing a later match', () => {
    const { doc } = replaceAll(
      docWith('cafe\u0301 x'),
      'x',
      'y',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );
    expect(textOf(doc)).toBe('cafe\u0301 y');
  });

  it('replaces a whole decomposed grapheme for a precomposed query', () => {
    const { doc } = replaceAll(
      docWith('cafe\u0301 x'),
      'café',
      'tea',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );
    expect(textOf(doc)).toBe('tea x');
  });

  it('preserves unrelated text and document structure', () => {
    const doc = docWith('keep cafe\u0301 X keep');
    const { doc: next } = replaceAll(
      doc,
      'X',
      'Y',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );
    expect(textOf(next)).toBe('keep cafe\u0301 Y keep');
    expect(next.nodes['text-1']).toMatchObject({ id: 'text-1', kind: 'text' });
  });
});

describe('whole word: Unicode word characters, never consumed', () => {
  it('does not treat digits or underscore as word boundaries', () => {
    const results = find(docWith('cat cat1 cat_cat concatenate cat'), 'cat', {
      wholeWord: true,
    });
    expect(results.map((r) => r.flatStart)).toEqual([0, 29]);
  });

  it('finds consecutive whole-word matches', () => {
    const results = find(docWith('cat cat'), 'cat', { wholeWord: true });
    expect(results.map((r) => r.flatStart)).toEqual([0, 4]);
  });

  it('treats combining marks, CJK, and emoji neighbours correctly', () => {
    // 'café' with combining mark: 'cat' should not match inside 'café'.
    expect(find(docWith('cafe\u0301 cat'), 'cat', { wholeWord: true })).toHaveLength(1);
    // CJK ideographs are letters, so they are word characters: 'cat' adjacent
    // to CJK is part of one word, while whitespace-separated 'cat' is whole.
    expect(find(docWith('猫cat猫'), 'cat', { wholeWord: true })).toHaveLength(0);
    expect(find(docWith('猫 cat 猫'), 'cat', { wholeWord: true })).toHaveLength(1);
    // Emoji are not word characters, so 'cat' beside an emoji is whole. The
    // emoji is written as a code-point escape rather than a literal so the
    // fixture keeps testing that exact neighbour while the repository's
    // zero-emoji source gate stays green.
    const PALETTE = '\u{1F3A8}';
    expect(find(docWith(`${PALETTE}cat${PALETTE}`), 'cat', { wholeWord: true })).toHaveLength(1);
  });

  it('applies whole word in regex mode without shifting offsets', () => {
    const results = find(docWith('cat concatenate cat'), 'cat', {
      wholeWord: true,
      useRegex: true,
    });
    expect(results.map((r) => r.flatStart)).toEqual([0, 16]);
    expect(results.map((r) => r.original)).toEqual(['cat', 'cat']);
  });
});

describe('regex: dialect, groups, and literal-vs-expansion', () => {
  it('expands named and numbered groups identically in bulk and single replace', () => {
    const rich: RichText = { paragraphs: [{ runs: [{ text: 'foo-12 foo-7' }] }] };
    const doc = docWith('foo-12 foo-7', rich);
    const options = { ...DEFAULT_SEARCH_OPTIONS, useRegex: true };
    const pattern = String.raw`(?<w>\w+)-(\d+)`;

    const bulk = replaceAll(doc, pattern, '$<w>:$2', options, 'document', [], false, false, false);
    expect(textOf(bulk.doc)).toBe('foo:12 foo:7');

    const match = find(doc, pattern, { useRegex: true })[0]!;
    const single = replaceSingle(doc, match, '$<w>:$2');
    expect(textOf(single)).toBe('foo:12 foo-7');
  });

  it('supports $&, $$, and leaves unknown groups literal', () => {
    const doc = docWith('ab');
    const match = find(doc, '(a)(b)', { useRegex: true })[0]!;
    expect(textOf(replaceSingle(doc, match, '$&$$'))).toBe('ab$');
    expect(textOf(replaceSingle(doc, match, '$2$1'))).toBe('ba');
    // Group 3 does not exist, so '$3' stays literal (GetSubstitution).
    expect(textOf(replaceSingle(doc, match, '$3'))).toBe('$3');
  });

  it('expands an unmatched group to empty', () => {
    const doc = docWith('a');
    const match = find(doc, '(a)|(z)', { useRegex: true })[0]!;
    expect(textOf(replaceSingle(doc, match, '<$2>'))).toBe('<>');
  });

  it('keeps replacement literal when regex mode is off', () => {
    const doc = docWith('a1');
    const { doc: next } = replaceAll(
      doc,
      'a',
      '$1',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );
    expect(textOf(next)).toBe('$11');
  });

  it('validates the pattern with the same flags used to execute it', () => {
    const invalid = searchInDocument(
      docWith('x'),
      '\\p{',
      { ...DEFAULT_SEARCH_OPTIONS, useRegex: true },
      'document',
      [],
      false,
      false,
      false,
    );
    expect(invalid.error?.code).toBe('invalid');
    expect(invalid.results).toHaveLength(0);
  });

  it('rejects nested quantifiers as unsupported rather than hanging', () => {
    const outcome = searchInDocument(
      docWith('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!'),
      '(a+)+$',
      { ...DEFAULT_SEARCH_OPTIONS, useRegex: true },
      'document',
      [],
      false,
      false,
      false,
    );
    expect(outcome.error?.code).toBe('unsupported');
    expect(outcome.results).toHaveLength(0);
  });

  it('advances safely past zero-width matches without looping', () => {
    const results = find(docWith('abc'), '(?=b)', { useRegex: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.zeroWidth).toBe(true);
    expect(results[0]?.flatStart).toBe(1);
  });

  it('declares the regex dialect: u flag is always on', () => {
    // With the u flag, \p{L} is a property escape and matches letters.
    const results = find(docWith('a1'), String.raw`\p{L}`, { useRegex: true });
    expect(results).toHaveLength(1);
  });
});

describe('paragraph separators are structural', () => {
  it('joins paragraphs through a real structural edit', () => {
    const rich: RichText = {
      paragraphs: [{ runs: [{ text: 'hello' }] }, { runs: [{ text: 'world' }] }],
    };
    const doc = docWith('hello\nworld', rich);
    const { doc: next } = replaceAll(
      doc,
      'hello\nworld',
      'hello world',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );
    expect(textOf(next)).toBe('hello world');
    expect((next.nodes['text-1'] as TextNode).richText?.paragraphs).toHaveLength(1);
  });

  it('creates a paragraph when the replacement contains a newline', () => {
    const doc = docWith('one two');
    const { doc: next } = replaceAll(
      doc,
      'two',
      'a\nb',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );
    expect(textOf(next)).toBe('one a\nb');
  });
});

describe('rich text formats survive replacement', () => {
  it('keeps unaffected runs and paragraph styles intact', () => {
    const rich: RichText = {
      paragraphs: [
        {
          format: { textAlign: 'center' },
          runs: [
            { text: 'red ', format: { color: '#ff0000' } as never },
            { text: 'target', format: { fontWeight: 700 } as never },
            { text: ' blue', format: { color: '#0000ff' } as never },
          ],
        },
      ],
    };
    const doc = docWith('red target blue', rich);
    const { doc: next } = replaceAll(
      doc,
      'target',
      'replaced',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );
    const paragraphs = (next.nodes['text-1'] as TextNode).richText?.paragraphs ?? [];
    expect(paragraphs).toHaveLength(1);
    const runs = paragraphs[0]?.runs ?? [];
    expect(runs.map((r) => r.text).join('')).toBe('red replaced blue');
    expect(runs[0]?.format).toMatchObject({ color: '#ff0000' });
    expect(runs[runs.length - 1]?.format).toMatchObject({ color: '#0000ff' });
    expect(paragraphs[0]?.format).toMatchObject({ textAlign: 'center' });
  });
});

describe('single replacement refuses a stale range instead of editing the wrong text', () => {
  it('does not apply an outdated offset after a prior length-changing edit', () => {
    const doc = docWith('cat cat');
    const results = find(doc, 'cat');
    expect(results).toHaveLength(2);
    const afterFirst = replaceSingle(doc, results[0]!, 'hippopotamus');
    expect(textOf(afterFirst)).toBe('hippopotamus cat');
    // The second match's original offset now addresses "pot" — refuse it.
    const afterStale = replaceSingle(afterFirst, results[1]!, 'X');
    expect(textOf(afterStale)).toBe('hippopotamus cat');
  });
});

describe('scope: roots, descendants, and empty selection', () => {
  it('includes text descendants of a selected group', () => {
    const doc = groupedChild('find me');
    const outcome = searchSpec(
      doc,
      spec({ scope: 'selection', selection: ['group-1'], query: 'find' }),
    );
    expect(outcome.results).toHaveLength(1);
  });

  it('does not broaden an empty selection to the document', () => {
    const outcome = searchSpec(docWith('find me'), spec({ scope: 'selection', query: 'find' }));
    expect(outcome.results).toHaveLength(0);
    expect(outcome.emptySelection).toBe(true);
  });

  it('de-duplicates a selected ancestor and its selected descendant', () => {
    const doc = groupedChild('find find');
    const outcome = searchSpec(
      doc,
      spec({ scope: 'selection', selection: ['group-1', 'child'], query: 'find' }),
    );
    expect(outcome.results).toHaveLength(2);
  });
});

describe('eligibility: protection, inheritance, and overrides', () => {
  it('marks a locked target find-only when not excluded', () => {
    const doc = docWith('find me', undefined);
    const locked = addNode(doc, textNode('locked-1', { text: 'find me too', locked: true }));
    const outcome = searchSpec(locked, spec({ query: 'find', excludeLocked: false }));
    const protectedMatches = outcome.results.filter((m) => m.protected);
    expect(protectedMatches.length).toBeGreaterThan(0);
    expect(protectedMatches[0]?.protectedReason).toBe('locked');
  });

  it('never edits a protected target', () => {
    const doc = addNode(
      docWith('find me'),
      textNode('locked-1', { text: 'find me too', locked: true }),
    );
    const s = spec({ query: 'find', excludeLocked: false });
    const plan = planReplacements(doc, s, 'FOUND');
    const result = applyReplacementPlan(doc, plan, plan.revision);
    expect(textOf(result.doc, 'locked-1')).toBe('find me too');
    expect(plan.skippedProtected).toBeGreaterThan(0);
  });

  it('inherits a hidden ancestor', () => {
    const doc = groupedChild('find me', { visible: false });
    const excluded = searchSpec(doc, spec({ query: 'find', excludeHidden: true }));
    expect(excluded.results).toHaveLength(0);
    expect(excluded.skipped.hidden).toBe(1);

    const included = searchSpec(doc, spec({ query: 'find', excludeHidden: false }));
    expect(included.results[0]?.protectedReason).toBe('hidden');
  });

  it('inherits a locked ancestor', () => {
    const doc = groupedChild('find me', { locked: true });
    const excluded = searchSpec(doc, spec({ query: 'find', excludeLocked: true }));
    expect(excluded.results).toHaveLength(0);
    const included = searchSpec(doc, spec({ query: 'find', excludeLocked: false }));
    expect(included.results[0]?.protectedReason).toBe('locked');
  });
});

describe('stories: one authoritative target, edited once', () => {
  function storyDoc() {
    const rich: RichText = { paragraphs: [{ runs: [{ text: 'brand story text' }] }] };
    let doc = createDocument('regression', true);
    doc = addNode(doc, textNode('f1', { storyBinding: { storyId: 'story-1', threadIndex: 0 } }));
    doc = addNode(doc, textNode('f2', { storyBinding: { storyId: 'story-1', threadIndex: 1 } }));
    doc = {
      ...doc,
      stories: {
        'story-1': { id: 'story-1', name: 'Story', content: rich, thread: ['f1', 'f2'] },
      },
    };
    return doc;
  }

  it('searches a linked story once and reports propagation', () => {
    const outcome = searchSpec(storyDoc(), spec({ query: 'brand' }));
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.targetKind).toBe('story');
    expect(outcome.results[0]?.shared).toBe(true);
    expect(outcome.results[0]?.frameIds).toEqual(['f1', 'f2']);
  });

  it('edits story content once, not once per frame', () => {
    const doc = storyDoc();
    const s = spec({ query: 'brand' });
    const plan = planReplacements(doc, s, 'BRAND');
    const result = applyReplacementPlan(doc, plan, plan.revision);
    expect(result.applied).toBe(1);
    expect(result.doc.stories?.['story-1']?.content.paragraphs[0]?.runs[0]?.text).toBe(
      'BRAND story text',
    );
  });
});

describe('commit safety', () => {
  it('rejects the whole plan when the revision moved', () => {
    const doc = docWith('find find');
    const s = spec({ query: 'find' });
    const plan = planReplacements(doc, s, 'X');
    const result = applyReplacementPlan(doc, plan, plan.revision + 1);
    expect(result.stale).toBe(true);
    expect(result.applied).toBe(0);
    expect(textOf(result.doc)).toBe('find find');
  });

  it('skips an edit whose range no longer matches, keeping the rest', () => {
    const doc = docWith('one find two find');
    const s = spec({ query: 'find' });
    const plan = planReplacements(doc, s, 'X');
    // Simulate a concurrent edit to the first occurrence.
    const edited = {
      ...doc,
      nodes: {
        ...doc.nodes,
        'text-1': { ...(doc.nodes['text-1'] as TextNode), text: 'one FUND two find' },
      },
    };
    const result = applyReplacementPlan(edited, plan, plan.revision);
    expect(result.applied).toBe(1);
    expect(result.skippedStale).toBe(1);
    expect(textOf(result.doc)).toBe('one FUND two X');
  });
});

describe('adjacent and growing replacements do not loop or corrupt', () => {
  it('handles a -> aa for every occurrence without rescanning inserted text', () => {
    const { doc, count } = replaceAll(
      docWith('a a a'),
      'a',
      'aa',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );
    expect(count).toBe(3);
    expect(textOf(doc)).toBe('aa aa aa');
  });

  it('treats an identical replacement as a no-op edit', () => {
    const doc = docWith('same');
    const s = spec({ query: 'same' });
    const plan = planReplacements(doc, s, 'same');
    const result = applyReplacementPlan(doc, plan, plan.revision);
    // Identical content must not create a history entry or dirty the document.
    expect(result.applied).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(textOf(result.doc)).toBe('same');
  });

  it('supports empty replacement as deletion', () => {
    const { doc } = replaceAll(
      docWith('remove me'),
      ' me',
      '',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );
    expect(textOf(doc)).toBe('remove');
  });
});
