/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
/**
 * Regression coverage for a bug found during Auto Layout canvas-manipulation
 * work: the frame's own Width and Height sizing selects (in the "Sizing"
 * sub-section) both called the same axis-agnostic setSelectedLayoutSizing,
 * so changing one axis silently overwrote the other.
 */
import { createMemoryPlatform } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { LayoutSection } from './LayoutSection';

afterEach(cleanup);

beforeEach(() => {
  sessionStorage.clear();
});

function setup() {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Harness() {
    ctx = useEditor();
    const id = ctx.state.selection[0];
    const frame = id ? ctx.state.document.nodes[id] : undefined;
    if (!frame || frame.kind !== 'frame') return null;
    return <LayoutSection node={frame} />;
  }
  const platform = createMemoryPlatform();
  render(
    <EditorProvider platform={platform}>
      <Harness />
    </EditorProvider>,
  );
  if (!ctx) throw new Error('ctx not found');
  return () => ctx as NonNullable<typeof ctx>;
}

describe('LayoutSection — per-node Width/Height sizing controls', () => {
  it('changing Width sizing sets layoutSizingWidth without touching layoutSizingHeight', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));

    fireEvent.click(screen.getByRole('combobox', { name: 'Width sizing mode' }));
    fireEvent.click(screen.getByRole('option', { name: 'Hug contents' }));

    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      const node = getCtx().state.document.nodes[id];
      expect(node?.layoutSizingWidth).toBe('hug');
      expect(node?.layoutSizingHeight).toBeUndefined();
    });
  });

  it('changing Height sizing sets layoutSizingHeight without touching layoutSizingWidth', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));

    fireEvent.click(screen.getByRole('combobox', { name: 'Height sizing mode' }));
    fireEvent.click(screen.getByRole('option', { name: 'Fill container' }));

    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      const node = getCtx().state.document.nodes[id];
      expect(node?.layoutSizingHeight).toBe('fill');
      expect(node?.layoutSizingWidth).toBeUndefined();
    });
  });

  it('setting both axes independently keeps them independent', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));

    fireEvent.click(screen.getByRole('combobox', { name: 'Width sizing mode' }));
    fireEvent.click(screen.getByRole('option', { name: 'Hug contents' }));
    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      expect(getCtx().state.document.nodes[id]?.layoutSizingWidth).toBe('hug');
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Height sizing mode' }));
    fireEvent.click(screen.getByRole('option', { name: 'Fill container' }));

    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      const node = getCtx().state.document.nodes[id];
      expect(node?.layoutSizingWidth).toBe('hug');
      expect(node?.layoutSizingHeight).toBe('fill');
    });
  });
});
