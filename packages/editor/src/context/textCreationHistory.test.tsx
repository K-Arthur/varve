/**
 * History-shape contract for text creation.
 *
 * Creating a text layer and typing into it must never leave the layer
 * present-but-empty after Undo. The original defect: creation pushed its
 * pre-creation snapshot directly and left no transaction open, so the
 * auto-entered text edit opened its OWN step. Undo then restored a
 * creation-time document whose layer existed with empty text — and because
 * automatic names follow the text, the layer silently became "Untitled text".
 */
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

function mountEditor() {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function TestComponent() {
    ctx = useEditor();
    return null;
  }
  render(
    <EditorProvider>
      <TestComponent />
    </EditorProvider>,
  );
  if (!ctx) throw new Error('editor context not mounted');
  return () => ctx as NonNullable<typeof ctx>;
}

const textTexts = (getCtx: () => ReturnType<typeof useEditor>) =>
  Object.values(getCtx().state.document.nodes)
    .filter((n) => n.kind === 'text')
    .map((n) => (n as { text: string }).text);

describe('text creation history shape', () => {
  it('records creation and its first typed burst as one step', async () => {
    const getCtx = mountEditor();

    // Create, then type the way TextEditOverlay does: the burst joins the
    // creation transaction rather than starting a step of its own.
    act(() => getCtx().createTextNodeAt({ x: 40, y: 40 }));
    await waitFor(() => expect(textTexts(getCtx)).toHaveLength(1));
    const textId = Object.values(getCtx().state.document.nodes).find((n) => n.kind === 'text')!.id;

    act(() => {
      getCtx().beginTransaction();
      getCtx().updateNode(textId, (n) => (n.kind === 'text' ? { ...n, text: 'hello world' } : n));
      getCtx().commitTransaction();
    });
    // TextEditOverlay's commit/blur handoff closes the outer creation level.
    act(() => getCtx().commitTransaction());
    await waitFor(() => expect(textTexts(getCtx)).toEqual(['hello world']));

    // One undo removes the layer together with its text.
    act(() => getCtx().undo());
    await waitFor(() => expect(textTexts(getCtx)).toEqual([]));
  });

  it('never leaves an empty text layer on any undo step', async () => {
    const getCtx = mountEditor();
    const createdIds: string[] = [];

    for (const [text, y] of [
      ['alpha', 20],
      ['beta', 80],
    ] as const) {
      const before = new Set(Object.keys(getCtx().state.document.nodes));
      act(() => getCtx().createTextNodeAt({ x: 20, y }));
      await waitFor(() =>
        expect(
          Object.values(getCtx().state.document.nodes).filter((n) => n.kind === 'text'),
        ).toHaveLength(text === 'alpha' ? 1 : 2),
      );
      const id = Object.keys(getCtx().state.document.nodes).find((key) => !before.has(key))!;
      createdIds.push(id);
      act(() => {
        getCtx().beginTransaction();
        getCtx().updateNode(id, (n) => (n.kind === 'text' ? { ...n, text } : n));
        getCtx().commitTransaction();
      });
      act(() => getCtx().commitTransaction());
    }
    await waitFor(() => expect(textTexts(getCtx).sort()).toEqual(['alpha', 'beta']));

    // Walk back the whole history. No step may produce a present-but-empty
    // layer — that is the data-loss signature this test exists to prevent.
    for (let step = 0; step < 4; step += 1) {
      act(() => getCtx().undo());
      await waitFor(() => {
        const texts = textTexts(getCtx);
        expect(texts).not.toContain('');
        for (const value of texts) expect(value.length).toBeGreaterThan(0);
      });
    }
  });
});
