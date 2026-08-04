// @vitest-environment jsdom

/**
 * Regression: scroll deltas must accumulate across a coalesced burst.
 *
 * Wheel events, inertia frames and auto-pan frames all fire faster than React
 * commits. The scroll handlers previously read `stateRef.current.pan` and
 * called `setPan(snapshot + delta)`, so every event in a burst resolved
 * against the *same* pre-commit snapshot and computed the same destination:
 * all but the last delta were discarded and a fast scroll travelled a
 * fraction of its input distance.
 *
 * `panBy` reads the base inside the state updater, so React's queue applies
 * each delta to the result of the previous one.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

const docJson = JSON.stringify({
  formatVersion: '1.3',
  nodes: {
    r1: {
      id: 'r1',
      name: 'Rect 1',
      kind: 'shape',
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      transform: [1, 0, 0, 1, 0, 0],
      strokes: [],
      effects: [],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
    },
  },
  rootChildren: ['r1'],
  components: {},
});

async function mountEditor() {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Capture() {
    ctx = useEditor();
    return null;
  }
  render(
    <EditorProvider initialDocumentJson={docJson}>
      <Capture />
    </EditorProvider>,
  );
  await waitFor(() => expect(ctx).toBeDefined());
  return () => ctx!;
}

afterEach(cleanup);

describe('scroll delta accumulation', () => {
  it('accumulates a burst of panBy calls made before React commits', async () => {
    const editor = await mountEditor();
    const start = editor().state.pan;

    // Three wheel events delivered in one task, as a trackpad produces.
    await act(async () => {
      editor().panBy(0, 40);
      editor().panBy(0, 40);
      editor().panBy(0, 40);
    });

    // The pre-fix absolute path landed on start.y + 40 here.
    expect(editor().state.pan.y).toBe(start.y + 120);
    expect(editor().state.pan.x).toBe(start.x);
  });

  it('accumulates both axes in order', async () => {
    const editor = await mountEditor();
    const start = editor().state.pan;

    await act(async () => {
      editor().panBy(5, 0);
      editor().panBy(-2, 12);
      editor().panBy(0, 3);
    });

    expect(editor().state.pan.x).toBe(start.x + 3);
    expect(editor().state.pan.y).toBe(start.y + 15);
  });

  it('ignores a zero delta without touching state', async () => {
    const editor = await mountEditor();
    const before = editor().state.pan;

    await act(async () => {
      editor().panBy(0, 0);
    });

    expect(editor().state.pan).toBe(before);
  });

  it('still supports absolute setPan for non-scroll callers', async () => {
    const editor = await mountEditor();

    await act(async () => {
      editor().setPan({ x: 25, y: 35 });
    });

    expect(editor().state.pan).toEqual({ x: 25, y: 35 });
  });
});
