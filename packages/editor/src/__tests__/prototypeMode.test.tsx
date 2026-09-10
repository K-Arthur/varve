// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../context';
import { Shell } from '../Shell';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('prototype mode', () => {
  it('does not show prototype presenter by default', () => {
    const { container } = render(<Shell />);
    expect(container.querySelector('.prototype-presenter')).toBeNull();
  });

  it('start/stop presentation works via context', async () => {
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
    expect(ctx?.state.isPresenting).toBe(false);

    ctx?.startPresentation();
    await waitFor(() => expect(ctx?.state.isPresenting).toBe(true));

    ctx?.stopPresentation();
    await waitFor(() => expect(ctx?.state.isPresenting).toBe(false));
  });

  it('getPrototypeScreens returns empty array when no frames', () => {
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
    expect(ctx?.getPrototypeScreens()).toEqual([]);
  });

  it('prototypeCurrentScreen defaults to empty string', () => {
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
    expect(ctx?.prototypeCurrentScreen).toBe('');
  });

  it('navigatePrototypeTo updates current screen', async () => {
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
    ctx?.navigatePrototypeTo('test-screen');
    await waitFor(() => expect(ctx?.prototypeCurrentScreen).toBe('test-screen'));
  });
});
