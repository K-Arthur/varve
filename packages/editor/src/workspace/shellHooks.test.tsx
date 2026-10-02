import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  layersDrawerStyle,
  useResponsiveDrawerFocus,
  useResponsivePanelClosers,
} from './shellHooks';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  delete document.documentElement.dataset.layoutMode;
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

function setupDrawerFocus(responsive = true, empty = false) {
  document.body.innerHTML = `
    <button id="drawer-trigger" aria-controls="responsive-drawer">Inspector</button>
    <aside id="responsive-drawer" role="dialog">
      ${empty ? '' : '<button id="drawer-first">Collapse</button><button id="drawer-last">Swap orientation</button>'}
    </aside>
  `;
  const trigger = document.getElementById('drawer-trigger') as HTMLButtonElement;
  const panel = document.getElementById('responsive-drawer')!;
  const first = document.getElementById('drawer-first') as HTMLButtonElement;
  const last = document.getElementById('drawer-last') as HTMLButtonElement;
  trigger.focus();
  const mediaQuery = Object.assign(new EventTarget(), {
    matches: responsive,
    media: '(max-width: 899px)',
  }) as MediaQueryList;
  vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 100, 32),
  );
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const frameId = ++nextFrameId;
    frames.set(frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
    frames.delete(frameId);
  });
  const initialProps = {
    layersVisible: false,
    inspectorVisible: true,
    libraryPanelVisible: false,
    closeResponsivePanels: vi.fn(),
  };
  const triggerRef = { current: trigger };
  const hook = renderHook(
    (props: typeof initialProps) =>
      useResponsiveDrawerFocus({
        ...props,
        triggerRef,
      }),
    { initialProps },
  );
  const flushFrames = () => {
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    });
  };
  const setViewportWidth = (width: number) => {
    const matches = width <= 899;
    if (mediaQuery.matches === matches) return;
    act(() => {
      Object.defineProperty(mediaQuery, 'matches', { configurable: true, value: matches });
      mediaQuery.dispatchEvent(new Event('change'));
    });
  };
  return {
    ...hook,
    initialProps,
    trigger,
    panel,
    first,
    last,
    frames,
    flushFrames,
    setViewportWidth,
  };
}

function drawerKey(target: HTMLElement, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('responsive drawer focus lifetime', () => {
  it('focuses on open once and preserves command focus across callback updates', () => {
    const controls = setupDrawerFocus();
    expect(document.activeElement).toBe(controls.trigger);
    controls.flushFrames();
    expect(document.activeElement).toBe(controls.first);
    controls.last.focus();
    const latestClose = vi.fn();
    controls.rerender({ ...controls.initialProps, closeResponsivePanels: latestClose });
    expect(controls.frames.size).toBe(0);
    expect(document.activeElement).toBe(controls.last);
    const event = drawerKey(controls.last, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(latestClose).toHaveBeenCalledOnce();
    expect(controls.initialProps.closeResponsivePanels).not.toHaveBeenCalled();
  });

  it('keeps Tab trapped using the current controls after a document update', () => {
    const controls = setupDrawerFocus();
    controls.flushFrames();
    controls.rerender({ ...controls.initialProps, closeResponsivePanels: vi.fn() });
    const added = document.createElement('button');
    added.textContent = 'New action';
    controls.panel.append(added);
    added.focus();
    expect(drawerKey(added, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls.first);
    expect(drawerKey(controls.first, 'Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(added);
  });

  it('focuses the first control again after an actual close and reopen', () => {
    const controls = setupDrawerFocus();
    controls.flushFrames();
    controls.last.focus();
    controls.rerender({ ...controls.initialProps, inspectorVisible: false });
    controls.trigger.focus();
    controls.rerender(controls.initialProps);
    expect(document.activeElement).toBe(controls.trigger);
    controls.flushFrames();
    expect(document.activeElement).toBe(controls.first);
  });

  it('cancels pending opening focus and removes keyboard capture when closed', () => {
    const controls = setupDrawerFocus();
    expect(controls.frames.size).toBe(1);
    controls.rerender({ ...controls.initialProps, inspectorVisible: false });
    expect(controls.frames.size).toBe(0);
    controls.flushFrames();
    expect(document.activeElement).toBe(controls.trigger);
    expect(drawerKey(controls.trigger, 'Escape').defaultPrevented).toBe(false);
    expect(controls.initialProps.closeResponsivePanels).not.toHaveBeenCalled();
  });

  it('leaves desktop panel focus and keyboard ownership alone', () => {
    const controls = setupDrawerFocus(false);
    expect(controls.frames.size).toBe(0);
    expect(document.activeElement).toBe(controls.trigger);
    expect(drawerKey(controls.trigger, 'Escape').defaultPrevented).toBe(false);
    expect(controls.initialProps.closeResponsivePanels).not.toHaveBeenCalled();
  });

  it('releases desktop keyboard ownership and reacquires mobile focus without closing', () => {
    const controls = setupDrawerFocus();
    controls.flushFrames();
    controls.last.focus();
    controls.setViewportWidth(1024);
    expect(controls.frames.size).toBe(0);
    expect(document.activeElement).toBe(controls.last);
    expect(drawerKey(controls.last, 'Tab').defaultPrevented).toBe(false);
    expect(drawerKey(controls.last, 'Escape').defaultPrevented).toBe(false);
    expect(controls.initialProps.closeResponsivePanels).not.toHaveBeenCalled();

    const latestClose = vi.fn();
    controls.rerender({ ...controls.initialProps, closeResponsivePanels: latestClose });
    controls.setViewportWidth(390);
    expect(document.activeElement).toBe(controls.last);
    controls.flushFrames();
    expect(document.activeElement).toBe(controls.first);
    controls.last.focus();
    expect(drawerKey(controls.last, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls.first);
    expect(drawerKey(controls.first, 'Escape').defaultPrevented).toBe(true);
    expect(latestClose).toHaveBeenCalledOnce();
    expect(controls.initialProps.closeResponsivePanels).not.toHaveBeenCalled();
  });

  it('cancels queued mobile focus on resize and unsubscribes when unmounted', () => {
    const controls = setupDrawerFocus();
    expect(controls.frames.size).toBe(1);
    controls.setViewportWidth(1024);
    expect(controls.frames.size).toBe(0);
    controls.flushFrames();
    expect(document.activeElement).toBe(controls.trigger);
    controls.unmount();
    controls.setViewportWidth(390);
    expect(controls.frames.size).toBe(0);
    expect(drawerKey(controls.trigger, 'Escape').defaultPrevented).toBe(false);
    expect(controls.initialProps.closeResponsivePanels).not.toHaveBeenCalled();
  });

  it('preserves tablet Inspector Tab behavior while Escape uses the latest closer', () => {
    document.documentElement.dataset.layoutMode = 'tablet';
    const controls = setupDrawerFocus();
    controls.flushFrames();
    controls.last.focus();
    const latestClose = vi.fn();
    controls.rerender({ ...controls.initialProps, closeResponsivePanels: latestClose });
    expect(drawerKey(controls.last, 'Tab').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(controls.last);
    expect(drawerKey(controls.last, 'Escape').defaultPrevented).toBe(true);
    expect(latestClose).toHaveBeenCalledOnce();
  });

  it('focuses an empty drawer and removes its temporary tabindex on cleanup', () => {
    const controls = setupDrawerFocus(true, true);
    controls.flushFrames();
    expect(document.activeElement).toBe(controls.panel);
    expect(controls.panel.getAttribute('tabindex')).toBe('-1');
    controls.unmount();
    expect(controls.panel.hasAttribute('tabindex')).toBe(false);
  });
});
