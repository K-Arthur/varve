import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layersDrawerStyle, useResponsivePanelClosers } from './shellHooks';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function setupClosers() {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  const callbacks = {
    setLayersVisible: vi.fn(),
    setInspectorVisible: vi.fn(),
    toggleLibraryPanel: vi.fn(),
    triggerRef: { current: trigger },
  };
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const hook = renderHook(
    (visibility: {
      layersVisible: boolean;
      inspectorVisible: boolean;
      libraryPanelVisible: boolean;
    }) => useResponsivePanelClosers({ ...visibility, ...callbacks }),
    { initialProps: { layersVisible: true, inspectorVisible: true, libraryPanelVisible: true } },
  );
  return { ...hook, ...callbacks, trigger, frames };
}

describe('responsive panel close controls', () => {
  it('uses the saved Layers width instead of its collapsed desktop grid width', () => {
    expect(layersDrawerStyle({ position: 'fixed' }, 260, '18rem')).toEqual({
      position: 'fixed',
      '--layers-drawer-width': '260px',
    });
    expect(layersDrawerStyle(undefined, null, '18rem')).toEqual({
      '--layers-drawer-width': '18rem',
    });
  });

  it('closes only Layers and returns focus to its drawer trigger', () => {
    const controls = setupClosers();
    act(() => controls.result.current.closeResponsiveLayers());
    expect(controls.setLayersVisible).toHaveBeenCalledWith(false);
    expect(controls.setInspectorVisible).not.toHaveBeenCalled();
    expect(controls.toggleLibraryPanel).not.toHaveBeenCalled();
    controls.frames[0]!(0);
    expect(document.activeElement).toBe(controls.trigger);
  });

  it('closes only the Inspector and returns focus to its drawer trigger', () => {
    const controls = setupClosers();
    act(() => controls.result.current.closeResponsiveInspector());
    expect(controls.setInspectorVisible).toHaveBeenCalledWith(false);
    expect(controls.setLayersVisible).not.toHaveBeenCalled();
    expect(controls.toggleLibraryPanel).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(controls.trigger);
    controls.frames[0]!(0);
    expect(document.activeElement).toBe(controls.trigger);
  });

  it('closes all open drawers on backdrop dismissal, without reopening Resources on a repeated close', () => {
    const controls = setupClosers();
    act(() => controls.result.current.closeResponsivePanels());
    expect(controls.setLayersVisible).toHaveBeenCalledWith(false);
    expect(controls.setInspectorVisible).toHaveBeenCalledWith(false);
    expect(controls.toggleLibraryPanel).toHaveBeenCalledOnce();
    controls.rerender({
      layersVisible: false,
      inspectorVisible: false,
      libraryPanelVisible: false,
    });
    act(() => controls.result.current.closeResponsivePanels());
    expect(controls.toggleLibraryPanel).toHaveBeenCalledOnce();
    expect(controls.frames).toHaveLength(1);
    controls.frames[0]!(0);
    expect(document.activeElement).toBe(controls.trigger);
  });
});
