import { render } from '@testing-library/react';
import { createDocument } from '@varve/scene';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PerspectiveTool } from '../tools/PerspectiveTool';
import type { ToolContext } from '../tools/types';
import { PerspectiveOverlay } from './PerspectiveOverlay';

const setTool = vi.fn();

vi.mock('../context', () => ({
  useEditor: () => ({ state: { document: createDocument('Perspective') }, setTool }),
}));

function fakeTool() {
  return {
    current: null,
    subscribe: () => () => {},
    commit: vi.fn(),
    cancel: vi.fn(),
    restoreOriginal: vi.fn(),
    setCorner: vi.fn(),
  };
}

describe('PerspectiveOverlay keyboard', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    setTool.mockClear();
  });

  it('cancels on Escape even when an earlier listener re-renders the canvas mid-dispatch', () => {
    const tool = fakeTool();
    const ctx = {} as ToolContext;
    const overlay = (buildToolCtx: () => ToolContext) => (
      <PerspectiveOverlay
        tool={tool as unknown as PerspectiveTool}
        zoom={1}
        pan={{ x: 0, y: 0 }}
        cameraRotation={0}
        buildToolCtx={buildToolCtx}
      />
    );

    let rerender: ((ui: React.ReactElement) => void) | null = null;
    // Registered before the overlay's listener, like the editor's global
    // shortcuts: it synchronously re-renders the canvas, which hands the
    // overlay a new buildToolCtx while the same Escape is still dispatching.
    const earlier = () => flushSync(() => rerender?.(overlay(() => ctx)));
    window.addEventListener('keydown', earlier);
    cleanups.push(() => window.removeEventListener('keydown', earlier));

    const view = render(overlay(() => ctx));
    rerender = view.rerender;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

    expect(tool.cancel).toHaveBeenCalledTimes(1);
    expect(setTool).toHaveBeenCalledWith('select');
  });
});
