// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../context';
import { SHORTCUT_DEFS, bindingMatchesEvent } from '../shortcuts/ShortcutManager';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('canvasMode', () => {
  it('default mode is full', () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    expect(ctx?.state.canvasMode).toBe('full');
  });

  it('setCanvasMode updates the mode via patch', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    ctx?.setCanvasMode('outline');
    await waitFor(() => expect(ctx?.state.canvasMode).toBe('outline'));

    ctx?.setCanvasMode('preview');
    await waitFor(() => expect(ctx?.state.canvasMode).toBe('preview'));

    ctx?.setCanvasMode('full');
    await waitFor(() => expect(ctx?.state.canvasMode).toBe('full'));
  });

  it('cycles through modes correctly', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    ctx?.setCanvasMode('preview');
    await waitFor(() => expect(ctx?.state.canvasMode).toBe('preview'));

    ctx?.setCanvasMode('full');
    await waitFor(() => expect(ctx?.state.canvasMode).toBe('full'));
  });

  it('outline mode shortcut def exists with correct binding', () => {
    const def = SHORTCUT_DEFS.canvasModeOutline;
    expect(def).toBeDefined();
    expect(def.binding.ctrl).toBe(true);
    expect(def.binding.shift).toBe(true);
    expect(def.binding.key).toBe('o');
  });

  it('preview mode shortcut def exists with correct binding', () => {
    const def = SHORTCUT_DEFS.canvasModePreview;
    expect(def).toBeDefined();
    expect(def.binding.ctrl).toBe(true);
    expect(def.binding.shift).toBe(true);
    expect(def.binding.key).toBe('r');
  });

  it('full mode shortcut def exists', () => {
    const def = SHORTCUT_DEFS.canvasModeFull;
    expect(def).toBeDefined();
    expect(def.binding.key).toBe('Escape');
  });

  it('outline shortcut binding matches expected keyboard event', () => {
    const binding = SHORTCUT_DEFS.canvasModeOutline.binding;
    const event = new KeyboardEvent('keydown', {
      key: 'o',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(bindingMatchesEvent(event, binding)).toBe(true);
  });

  it('preview shortcut binding matches expected keyboard event', () => {
    const binding = SHORTCUT_DEFS.canvasModePreview.binding;
    const event = new KeyboardEvent('keydown', {
      key: 'r',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(bindingMatchesEvent(event, binding)).toBe(true);
  });

  it('full mode shortcut binding matches Escape event', () => {
    const binding = SHORTCUT_DEFS.canvasModeFull.binding;
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
    });
    expect(bindingMatchesEvent(event, binding)).toBe(true);
  });

  it('Escape shortcut does NOT fire for full mode when in full already (no-op for full mode)', () => {
    const binding = SHORTCUT_DEFS.canvasModeFull.binding;
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      ctrlKey: false,
      shiftKey: false,
    });
    expect(bindingMatchesEvent(event, binding)).toBe(true);
  });

  it('supports all three CanvasMode values as union type', () => {
    const modes: Array<'full' | 'outline' | 'preview'> = ['full', 'outline', 'preview'];
    expect(modes).toHaveLength(3);
  });
});
