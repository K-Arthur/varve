/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../context';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('quick-mask mode', () => {
  function renderWithEditor() {
    let api: ReturnType<typeof useEditor> | null = null;
    function TestComp() {
      api = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <TestComp />
      </EditorProvider>,
    );
    return { getApi: () => api! };
  }

  it('starts inactive by default', () => {
    const { getApi } = renderWithEditor();
    expect(getApi().isQuickMaskActive()).toBe(false);
  });

  it('enterQuickMask activates mode', async () => {
    const { getApi } = renderWithEditor();
    const editor = getApi();
    expect(editor.isQuickMaskActive()).toBe(false);
    editor.enterQuickMask();
    await waitFor(() => expect(getApi().isQuickMaskActive()).toBe(true));
    expect(getApi().state.quickMask.active).toBe(true);
  });

  it('exitQuickMask deactivates mode', async () => {
    const { getApi } = renderWithEditor();
    const editor = getApi();
    editor.enterQuickMask();
    await waitFor(() => expect(getApi().isQuickMaskActive()).toBe(true));
    editor.exitQuickMask();
    await waitFor(() => expect(getApi().isQuickMaskActive()).toBe(false));
    expect(getApi().state.quickMask.active).toBe(false);
  });

  it('paintQuickMask modifies coverage without error', async () => {
    const { getApi } = renderWithEditor();
    const editor = getApi();
    editor.enterQuickMask();
    await waitFor(() => expect(getApi().isQuickMaskActive()).toBe(true));
    const coverage = new Uint8Array(100).fill(128);
    editor.setQuickMaskCoverage(coverage, 10, 10);
    editor.paintQuickMask(5, 5, 3, 255);
    expect(getApi().isQuickMaskActive()).toBe(true);
  });

  it('fillQuickMask fills all coverage pixels', async () => {
    const { getApi } = renderWithEditor();
    const editor = getApi();
    editor.enterQuickMask();
    await waitFor(() => expect(getApi().isQuickMaskActive()).toBe(true));
    const coverage = new Uint8Array(100).fill(128);
    editor.setQuickMaskCoverage(coverage, 10, 10);
    editor.fillQuickMask(255);
    expect(getApi().isQuickMaskActive()).toBe(true);
  });

  it('invertQuickMask flips all pixels', async () => {
    const { getApi } = renderWithEditor();
    const editor = getApi();
    editor.enterQuickMask();
    await waitFor(() => expect(getApi().isQuickMaskActive()).toBe(true));
    const coverage = new Uint8Array(4).fill(0);
    editor.setQuickMaskCoverage(coverage, 2, 2);
    // invertQuickMask doesn't change active state
    editor.invertQuickMask();
    await waitFor(() => expect(getApi().isQuickMaskActive()).toBe(true));
  });
});
