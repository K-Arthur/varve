/**
 * Per-node export preset reducers (addPreset / updatePreset / removePreset).
 *
 * These back the inspector's "Export settings" section and are what
 * ExportDialog.buildJobs() reads to expand a batch, so they are the hinge
 * between the compact inspector and the advanced batch surface. They had no
 * direct coverage before — the component tests only asserted that the
 * callbacks fired, not that the document actually changed.
 */

import type { ExportPreset } from '@strata/scene';
import { render, waitFor } from '@testing-library/react';
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

const png2x: ExportPreset = {
  id: 'p1',
  format: 'png',
  scale: { type: 'factor', value: 2 },
  suffix: '@2x',
  enabled: true,
};

const printX4: ExportPreset = {
  id: 'p2',
  format: 'pdf-x4',
  scale: { type: 'factor', value: 1 },
  suffix: '',
  enabled: true,
};

/** Create a frame and return its node id. */
async function makeFrame(getCtx: () => ReturnType<typeof useEditor>): Promise<string> {
  getCtx().applyFramePreset({ name: 'Test', w: 100, h: 100 });
  let id = '';
  await waitFor(() => {
    const frame = Object.values(getCtx().state.document.nodes).find((n) => n.kind === 'frame');
    if (!frame) throw new Error('no frame yet');
    id = frame.id;
  });
  return id;
}

describe('per-node export preset reducers', () => {
  it('adds presets onto node.presets, preserving order', async () => {
    const getCtx = setup();
    const id = await makeFrame(getCtx);

    getCtx().addPreset(id, png2x);
    await waitFor(() => {
      expect(getCtx().state.document.nodes[id]?.presets).toHaveLength(1);
    });

    getCtx().addPreset(id, printX4);
    await waitFor(() => {
      const presets = getCtx().state.document.nodes[id]?.presets ?? [];
      expect(presets.map((p) => p.format)).toEqual(['png', 'pdf-x4']);
    });
  });

  it('updates a preset in place without disturbing its siblings', async () => {
    const getCtx = setup();
    const id = await makeFrame(getCtx);
    getCtx().addPreset(id, png2x);
    getCtx().addPreset(id, printX4);
    await waitFor(() => {
      expect(getCtx().state.document.nodes[id]?.presets).toHaveLength(2);
    });

    getCtx().updatePreset(id, { ...png2x, enabled: false, suffix: '@3x' });
    await waitFor(() => {
      const presets = getCtx().state.document.nodes[id]?.presets ?? [];
      expect(presets[0]).toMatchObject({ id: 'p1', enabled: false, suffix: '@3x' });
      // Sibling untouched, order stable.
      expect(presets[1]).toMatchObject({ id: 'p2', format: 'pdf-x4' });
    });
  });

  it('removes only the targeted preset', async () => {
    const getCtx = setup();
    const id = await makeFrame(getCtx);
    getCtx().addPreset(id, png2x);
    getCtx().addPreset(id, printX4);
    await waitFor(() => {
      expect(getCtx().state.document.nodes[id]?.presets).toHaveLength(2);
    });

    getCtx().removePreset(id, 'p1');
    await waitFor(() => {
      const presets = getCtx().state.document.nodes[id]?.presets ?? [];
      expect(presets).toHaveLength(1);
      expect(presets[0]?.id).toBe('p2');
    });
  });

  it('ignores operations on a missing node instead of throwing', async () => {
    const getCtx = setup();
    await makeFrame(getCtx);

    expect(() => getCtx().addPreset('does-not-exist', png2x)).not.toThrow();
    expect(() => getCtx().updatePreset('does-not-exist', png2x)).not.toThrow();
    expect(() => getCtx().removePreset('does-not-exist', 'p1')).not.toThrow();
  });
});
