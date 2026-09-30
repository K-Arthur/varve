/**
 * Integration tests for the find/replace controller (hook layer).
 *
 * These exercise the transactional contract the UI depends on: one undo entry
 * per Replace All, a frozen scope, revision-safe commit, and result remapping
 * after a single replacement.
 */

import { act, renderHook } from '@testing-library/react';
import { addNode, createDocument, type Document, type TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { useFindReplace } from './useFindReplace';

function textNode(id: string, text: string): TextNode {
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
    text,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fontSize: 16,
    strokes: [],
    effects: [],
  };
}

function docWith(...nodes: TextNode[]): Document {
  let doc = createDocument('hook', true);
  for (const node of nodes) doc = addNode(doc, node);
  return doc;
}

function textOf(doc: Document, id: string): string {
  return (doc.nodes[id] as TextNode).text;
}

function harness(initialDoc: Document, initialSelection: string[] = []) {
  let doc = initialDoc;
  let revision = 0;
  let selection = [...initialSelection];
  const updateCalls: number[] = [];
  const updateRefs: Array<'same' | 'fresh'> = [];
  const transactions: string[] = [];
  const announcements: string[] = [];
  let lastSelection: string | null = null;

  const view = renderHook(
    ({ rev }) =>
      useFindReplace(
        () => doc,
        () => selection,
        (fn) => {
          const before = doc;
          const next = fn(doc);
          updateCalls.push(updateCalls.length);
          updateRefs.push(next === before ? 'same' : 'fresh');
          doc = next;
        },
        () => transactions.push('begin'),
        () => transactions.push('commit'),
        (id) => {
          lastSelection = id;
        },
        (msg) => announcements.push(msg),
        rev,
        () => revision,
      ),
    { initialProps: { rev: 0 } },
  );

  return {
    ...view,
    getDoc: () => doc,
    setRevision: (value: number) => {
      revision = value;
      view.rerender({ rev: value });
    },
    setSelection: (ids: string[]) => {
      selection = [...ids];
    },
    updateCalls,
    updateRefs: () => updateRefs,
    transactions,
    announcements,
    lastSelection: () => lastSelection,
  };
}

describe('useFindReplace: transactional replacement', () => {
  it('commits Replace All as one update inside one transaction', () => {
    const h = harness(docWith(textNode('t1', 'find find'), textNode('t2', 'find')));
    act(() => h.result.current.setSearchText('find'));
    act(() => h.result.current.setReplaceText('X'));
    act(() => h.result.current.search());
    expect(h.result.current.state.status).toBe('ready');
    expect(h.result.current.state.results).toHaveLength(3);

    act(() => h.result.current.replaceAll());

    expect(textOf(h.getDoc(), 't1')).toBe('X X');
    expect(textOf(h.getDoc(), 't2')).toBe('X');
    expect(h.updateCalls).toHaveLength(1);
    expect(h.transactions).toEqual(['begin', 'commit']);
    expect(h.result.current.state.lastApplied).toBe(3);
    expect(h.announcements.at(-1)).toBe('Replaced 3 occurrences');
  });

  it('does not create a history entry when nothing changes', () => {
    const h = harness(docWith(textNode('t1', 'find')));
    act(() => h.result.current.setSearchText('find'));
    act(() => h.result.current.search());
    act(() => h.result.current.setReplaceText('find'));
    act(() => h.result.current.replaceAll());

    // The updater may be invoked, but it must return the SAME document
    // reference so `commitTransaction` records no history entry (its change
    // check is reference equality) and the document is not dirtied.
    expect(h.updateRefs()).toEqual(['same']);
    expect(h.transactions).toEqual(['begin', 'commit']);
    expect(h.result.current.state.lastApplied).toBeNull();
    expect(textOf(h.getDoc(), 't1')).toBe('find');
  });

  it('rejects Replace All once the revision moved (stale results)', () => {
    const h = harness(docWith(textNode('t1', 'find find')));
    act(() => h.result.current.setSearchText('find'));
    act(() => h.result.current.search());
    act(() => h.setRevision(1));
    expect(h.result.current.state.status).toBe('stale');

    act(() => h.result.current.replaceAll());
    expect(textOf(h.getDoc(), 't1')).toBe('find find');
    expect(h.updateCalls).toHaveLength(0);
  });
});

describe('useFindReplace: frozen scope', () => {
  it('keeps the search scope after canvas selection changes', () => {
    const h = harness(docWith(textNode('t1', 'find one'), textNode('t2', 'find two')), ['t1']);
    act(() => h.result.current.setSearchText('find'));
    act(() => h.result.current.setScope('selection'));
    act(() => h.result.current.setReplaceText('X'));
    act(() => h.result.current.search());
    expect(h.result.current.state.results).toHaveLength(1);
    expect(h.result.current.state.spec?.selection).toEqual(['t1']);

    // Canvas selection changes; the frozen scope must not follow it.
    act(() => h.setSelection(['t2']));
    act(() => h.result.current.goToNext());
    expect(h.result.current.state.spec?.selection).toEqual(['t1']);

    act(() => h.result.current.replaceAll());
    expect(textOf(h.getDoc(), 't1')).toBe('X one');
    expect(textOf(h.getDoc(), 't2')).toBe('find two');
  });

  it('refreshes the frozen scope only through Update from selection', () => {
    const h = harness(docWith(textNode('t1', 'find one'), textNode('t2', 'find two')), ['t1']);
    act(() => h.result.current.setSearchText('find'));
    act(() => h.result.current.setScope('selection'));
    act(() => h.result.current.search());
    act(() => h.setSelection(['t2']));
    act(() => h.result.current.updateFromSelection());

    expect(h.result.current.state.spec?.selection).toEqual(['t2']);
    expect(h.result.current.state.results).toHaveLength(1);
    expect(h.result.current.state.results[0]?.targetId).toBe('t2');
  });
});

describe('useFindReplace: single replacement remaps results', () => {
  it('replaces the next correct match after a length-changing edit', () => {
    const h = harness(docWith(textNode('t1', 'cat cat')));
    act(() => h.result.current.setSearchText('cat'));
    act(() => h.result.current.setReplaceText('hippopotamus'));
    act(() => h.result.current.search());
    expect(h.result.current.state.results).toHaveLength(2);

    act(() => h.result.current.replace(h.result.current.state.results[0]!));
    expect(textOf(h.getDoc(), 't1')).toBe('hippopotamus cat');
    expect(h.result.current.state.results).toHaveLength(1);
    expect(h.result.current.state.results[0]?.flatStart).toBe(13);

    act(() => h.result.current.setReplaceText('X'));
    act(() => h.result.current.replace(h.result.current.state.results[0]!));
    expect(textOf(h.getDoc(), 't1')).toBe('hippopotamus X');
  });

  it('Replace and Find Next advances to the following match', () => {
    const h = harness(docWith(textNode('t1', 'a a a')));
    act(() => h.result.current.setSearchText('a'));
    act(() => h.result.current.setReplaceText('X'));
    act(() => h.result.current.search());
    act(() => h.result.current.replaceAndFindNext());
    expect(textOf(h.getDoc(), 't1')).toBe('X a a');
    expect(h.lastSelection()).toBe('t1');
    expect(h.result.current.state.currentIndex).toBe(0);
  });

  it('reports protected matches as find-only and never edits them', () => {
    const locked = { ...textNode('t2', 'find'), locked: true };
    const h = harness(docWith(textNode('t1', 'find'), locked));
    act(() => h.result.current.setExcludeLocked(false));
    act(() => h.result.current.setSearchText('find'));
    act(() => h.result.current.search());

    const protectedMatch = h.result.current.state.results.find((m) => m.protected);
    expect(protectedMatch?.protectedReason).toBe('locked');
    act(() => h.result.current.replace(protectedMatch!));
    expect(textOf(h.getDoc(), 't2')).toBe('find');
  });
});

describe('useFindReplace: regex capture templates', () => {
  it('expands named groups through Replace All and single Replace consistently', () => {
    const h = harness(docWith(textNode('t1', 'foo-12 foo-7')));
    act(() => h.result.current.setOption('useRegex', true));
    act(() => h.result.current.setSearchText(String.raw`(?<w>\w+)-(\d+)`));
    act(() => h.result.current.setReplaceText('$<w>:$2'));
    act(() => h.result.current.search());
    expect(h.result.current.state.results).toHaveLength(2);

    act(() => h.result.current.replace(h.result.current.state.results[0]!));
    expect(textOf(h.getDoc(), 't1')).toBe('foo:12 foo-7');

    act(() => h.result.current.replaceAll());
    expect(textOf(h.getDoc(), 't1')).toBe('foo:12 foo:7');
  });
});

describe('useFindReplace: invalid patterns are a distinct state', () => {
  it('surfaces an actionable error and disables replacement', () => {
    const h = harness(docWith(textNode('t1', 'abc')));
    act(() => h.result.current.setOption('useRegex', true));
    act(() => h.result.current.setSearchText('(a+)+$'));
    act(() => h.result.current.search());

    expect(h.result.current.state.status).toBe('error');
    expect(h.result.current.state.error).toMatch(/nested quantifiers/i);
    expect(h.result.current.state.results).toHaveLength(0);
    act(() => h.result.current.replaceAll());
    expect(h.updateCalls).toHaveLength(0);
  });
});
