import { act, renderHook } from '@testing-library/react';
import { addNode, createDocument, type Document, type TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { useFindReplace } from './useFindReplace';

/**
 * Verifies the exact ordering the shell's history engine depends on: the whole
 * batch must be produced by ONE `updateDoc` call between one begin/commit pair,
 * and the document handed to `updateDoc` must be a fresh reference (that is how
 * `commitTransaction` decides a transaction actually changed the document).
 */

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

describe('useFindReplace history contract', () => {
  it('produces one fresh document reference inside a single transaction', () => {
    let doc: Document = addNode(
      addNode(createDocument('h', true), textNode('a', 'brand brand')),
      textNode('b', 'brand'),
    );
    const events: string[] = [];
    const seenRefs: Document[] = [];

    const { result } = renderHook(() =>
      useFindReplace(
        () => doc,
        () => [],
        (fn) => {
          const before = doc;
          const next = fn(doc);
          events.push(next === before ? 'updateDoc:same' : 'updateDoc:fresh');
          seenRefs.push(next);
          doc = next;
        },
        () => events.push('begin'),
        () => events.push('commit'),
        () => {},
        () => {},
        0,
        () => 0,
      ),
    );

    act(() => result.current.setSearchText('brand'));
    act(() => result.current.setReplaceText('brandmark'));
    act(() => result.current.search());
    expect(result.current.state.results).toHaveLength(3);

    act(() => result.current.replaceAll());

    // Exactly one edit, one transaction, and a new document reference.
    expect(events).toEqual(['begin', 'updateDoc:fresh', 'commit']);
    expect((doc.nodes.a as TextNode).text).toBe('brandmark brandmark');
    expect((doc.nodes.b as TextNode).text).toBe('brandmark');
  });
});
