/**
 * Attaching text to a path.
 *
 * The engine has placed glyphs along a shape for a long time and the document
 * model has carried `textMode: 'path'` for just as long, but no editor surface
 * ever set it — the capability was unreachable. These cases cover the action
 * that closes that gap, and the invariants a demo of it depends on.
 */
import type { SceneNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { createActionHandlers } from './createActionHandlers';

function textNode(id = 'text-1'): SceneNode {
  return { id, kind: 'text', name: 'Badge label', text: 'VELO CLUB' } as unknown as SceneNode;
}

function circleNode(id = 'circle-1'): SceneNode {
  return {
    id,
    kind: 'shape',
    name: 'Badge ring',
    shape: { kind: 'circle', cx: 200, cy: 200, r: 140 },
  } as unknown as SceneNode;
}

/** An editor whose updateNode actually mutates, so writes can be asserted. */
function makeEditor(nodes: SceneNode[], selection: string[]) {
  const byId: Record<string, SceneNode> = {};
  for (const n of nodes) byId[n.id] = n;
  const announce = vi.fn();
  const editor = {
    state: { selection, document: { nodes: byId } },
    updateNode: (id: string, updater: (n: SceneNode) => SceneNode) => {
      const current = byId[id];
      if (current) byId[id] = updater(current);
    },
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    announce,
  } as unknown as EditorContextValue;
  return { editor, byId, announce };
}

type PathText = { pathNodeId: string; startOffset?: number; side?: string };
const asText = (n: SceneNode) => n as unknown as { textMode?: string; pathTextSettings?: PathText };

describe('attachTextToPath', () => {
  it('puts the text into path mode against the selected shape', () => {
    const { editor, byId } = makeEditor([textNode(), circleNode()], ['text-1', 'circle-1']);
    createActionHandlers(editor, {}).attachTextToPath?.();

    const text = asText(byId['text-1']!);
    expect(text.textMode).toBe('path');
    expect(text.pathTextSettings?.pathNodeId).toBe('circle-1');
  });

  it('seeds the settings the renderer reads', () => {
    const { editor, byId } = makeEditor([textNode(), circleNode()], ['text-1', 'circle-1']);
    createActionHandlers(editor, {}).attachTextToPath?.();

    expect(asText(byId['text-1']!).pathTextSettings).toMatchObject({ startOffset: 0, side: 'top' });
  });

  it('leaves the path node untouched so it stays independently editable', () => {
    const circle = circleNode();
    const { editor, byId } = makeEditor([textNode(), circle], ['text-1', 'circle-1']);
    createActionHandlers(editor, {}).attachTextToPath?.();

    // Attaching must not consume, hide or rewrite the geometry: the demo
    // depends on the ring keeping its own fill and node editing.
    expect(byId['circle-1']).toBe(circle);
  });

  it('commits as one undoable transaction', () => {
    const { editor } = makeEditor([textNode(), circleNode()], ['text-1', 'circle-1']);
    createActionHandlers(editor, {}).attachTextToPath?.();

    expect(editor.beginTransaction).toHaveBeenCalledTimes(1);
    expect(editor.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('says what is missing rather than silently doing nothing', () => {
    const { editor, announce, byId } = makeEditor([textNode()], ['text-1']);
    createActionHandlers(editor, {}).attachTextToPath?.();

    expect(announce).toHaveBeenCalledWith('Select a text layer and a shape to place the text on');
    expect(asText(byId['text-1']!).textMode).toBeUndefined();
  });

  it('does nothing without a text layer in the selection', () => {
    const { editor, announce } = makeEditor([circleNode()], ['circle-1']);
    createActionHandlers(editor, {}).attachTextToPath?.();

    expect(announce).toHaveBeenCalledWith('Select a text layer and a shape to place the text on');
  });

  it('preserves an offset the user already dialled in when re-attaching', () => {
    const existing = {
      ...textNode(),
      textMode: 'path',
      pathTextSettings: { pathNodeId: 'old', startOffset: 0.25, side: 'bottom' },
    } as unknown as SceneNode;
    const { editor, byId } = makeEditor([existing, circleNode()], ['text-1', 'circle-1']);
    createActionHandlers(editor, {}).attachTextToPath?.();

    expect(asText(byId['text-1']!).pathTextSettings).toMatchObject({
      pathNodeId: 'circle-1',
      startOffset: 0.25,
      side: 'bottom',
    });
  });
});

describe('detachTextFromPath', () => {
  const attached = () =>
    ({
      ...textNode(),
      textMode: 'path',
      pathTextSettings: { pathNodeId: 'circle-1', startOffset: 0.1, side: 'top' },
    }) as unknown as SceneNode;

  it('returns the text to a point label and drops the path settings', () => {
    const { editor, byId } = makeEditor([attached(), circleNode()], ['text-1']);
    createActionHandlers(editor, {}).detachTextFromPath?.();

    const text = asText(byId['text-1']!);
    expect(text.textMode).toBe('point');
    expect(text.pathTextSettings).toBeUndefined();
  });

  it('keeps the path node in the document', () => {
    const { editor, byId } = makeEditor([attached(), circleNode()], ['text-1']);
    createActionHandlers(editor, {}).detachTextFromPath?.();

    expect(byId['circle-1']).toBeDefined();
  });

  it('reports when the selected text is not on a path', () => {
    const { editor, announce } = makeEditor([textNode()], ['text-1']);
    createActionHandlers(editor, {}).detachTextFromPath?.();

    expect(announce).toHaveBeenCalledWith('Select a text layer that is on a path');
  });
});
