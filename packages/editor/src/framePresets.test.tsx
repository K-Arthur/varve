/**
 * Frame preset tests — verify the Figma-model applyFramePreset context method
 * creates a correctly-sized frame and resizes a selected frame in place.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from './context';
import { FRAME_PRESET_GROUPS } from './framePresets';

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

describe('frame presets', () => {
  it('every preset has positive dimensions and a unique id', () => {
    const seen = new Set<string>();
    for (const group of FRAME_PRESET_GROUPS) {
      for (const p of group.presets) {
        expect(p.w).toBeGreaterThan(0);
        expect(p.h).toBeGreaterThan(0);
        expect(seen.has(p.id)).toBe(false);
        seen.add(p.id);
      }
    }
  });

  it('applyFramePreset creates a new frame of the preset size', async () => {
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

  it('applyFramePreset resizes a single selected frame in place', async () => {
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
