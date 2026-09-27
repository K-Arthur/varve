// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { createDocument, type Document, makeShapeNode, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { useFontStableDocument } from '../useDocumentFonts';

function docWithText(): Document {
  const base = createDocument('fonts');
  const text = makeTextNode('t1', 'Hello', { fontFamily: 'Inter' });
  const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  return {
    ...base,
    nodes: { ...base.nodes, t1: text, s1: shape },
    rootChildren: [...base.rootChildren, 't1', 's1'],
  };
}

describe('useFontStableDocument', () => {
  it('keeps the previous document across moves and follows font changes', () => {
    const doc = docWithText();
    const { result, rerender } = renderHook(({ d }) => useFontStableDocument(d), {
      initialProps: { d: doc },
    });
    expect(result.current).toBe(doc);

    const moved: Document = {
      ...doc,
      nodes: { ...doc.nodes, s1: { ...doc.nodes.s1!, transform: [1, 0, 0, 1, 9, 9] } },
    };
    rerender({ d: moved });
    expect(result.current).toBe(doc);

    const text = doc.nodes.t1!;
    const refonted: Document = {
      ...moved,
      nodes: { ...moved.nodes, t1: { ...text, fontFamily: 'Geist' } as typeof text },
    };
    rerender({ d: refonted });
    expect(result.current).toBe(refonted);

    const grown: Document = {
      ...refonted,
      nodes: {
        ...refonted.nodes,
        t2: makeTextNode('t2', 'World', { fontFamily: 'Lora' }),
      },
      rootChildren: [...refonted.rootChildren, 't2'],
    };
    rerender({ d: grown });
    expect(result.current).toBe(grown);
  });
});
