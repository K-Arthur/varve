/**
 * applyFramePreset tests — verifies the context method creates a
 * correctly-sized frame and resizes a selected frame in place. Relocated
 * from framePresets.test.tsx (the old FRAME_PRESET_GROUPS registry is gone;
 * applyFramePreset only ever takes a plain {name, w, h}, so these use
 * hand-written literals instead of importing from a registry).
 */

import { render, waitFor } from '@testing-library/react';
import { activePageNodes } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from './context';

function setup() {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Probe() {
    ctx = useEditor();
    return null;
  }
  render(
    <EditorProvider>
      <Probe />
    </EditorProvider>,
  );
  if (!ctx) throw new Error('ctx not found');
  return () => ctx as NonNullable<typeof ctx>;
}

describe('applyFramePreset', () => {
  it('creates a new frame of the preset size', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'iPhone 15 Pro', w: 393, h: 852 });

    await waitFor(() => {
      const frames = Object.values(getCtx().state.document.nodes).filter((n) => n.kind === 'frame');
      expect(frames).toHaveLength(1);
      const frame = frames[0];
      if (frame?.kind !== 'frame') throw new Error('frame not created');
      expect(frame.w).toBe(393);
      expect(frame.h).toBe(852);
    });
  });

  it('scopes the new frame to the active page (visible on canvas, not just in doc.nodes)', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'iPhone 15 Pro', w: 393, h: 852 });

    await waitFor(() => {
      const doc = getCtx().state.document;
      const frames = Object.values(doc.nodes).filter((n) => n.kind === 'frame');
      expect(frames).toHaveLength(1);
      const frame = frames[0];
      if (!frame) throw new Error('frame not created');
      // The canvas renderer walks activePageNodes(doc), not doc.rootChildren
      // directly — a frame added only to doc.rootChildren exists in the doc
      // (and shows in the Layers panel) but never paints on screen.
      expect(activePageNodes(doc)).toContain(frame.id);
    });
  });

  it('resizes a single selected frame in place', async () => {
    const getCtx = setup();
    // Create the first frame.
    getCtx().applyFramePreset({ name: 'iPhone 15 Pro', w: 393, h: 852 });

    let frameId = '';
    await waitFor(() => {
      const frames = Object.values(getCtx().state.document.nodes).filter((n) => n.kind === 'frame');
      expect(frames).toHaveLength(1);
      frameId = frames[0]?.id ?? '';
      expect(frameId).not.toBe('');
    });

    // With the frame selected, applying another preset resizes it (no new node).
    getCtx().applyFramePreset({ name: 'iPad Air', w: 820, h: 1180 });

    await waitFor(() => {
      const frames = Object.values(getCtx().state.document.nodes).filter((n) => n.kind === 'frame');
      expect(frames).toHaveLength(1);
      const frame = frames[0];
      if (frame?.kind !== 'frame') throw new Error('frame missing');
      expect(frame.id).toBe(frameId);
      expect(frame.w).toBe(820);
      expect(frame.h).toBe(1180);
    });
  });
});
