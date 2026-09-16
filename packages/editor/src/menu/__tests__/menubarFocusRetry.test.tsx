/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMenubarFocusEffects } from '../menubarFocus';

/**
 * Coverage for the bounded focus-retry added to useMenubarFocusEffects.
 *
 * FloatingPortal keeps a menu layer visibility:hidden until its positioning
 * effect lands; focus() on an element inside that layer is silently ignored.
 * The hook must retry the handoff a bounded number of frames while focus is
 * still in a state the open owns, and must stop once focus landed or the user
 * deliberately moved it somewhere else.
 */

const realFocus = HTMLElement.prototype.focus;
let refusals = 0;
let focusAttempts = 0;

function Harness({ openMenu = 'File' }: { openMenu?: string | null }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const prevOpenMenuRef = useRef<string | null>(null);
  const tabWalkDirRef = useRef<1 | -1 | null>(null);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState(0);
  useMenubarFocusEffects({
    openMenu,
    openSubmenu: null,
    activeItemIndex,
    activeSubmenuIndex,
    menuRef,
    dropdownMenuRef,
    submenuRef,
    restoreFocusRef,
    prevOpenMenuRef,
    tabWalkDirRef,
    setActiveItemIndex,
    setActiveSubmenuIndex,
  });
  return (
    <div ref={menuRef}>
      <div ref={dropdownMenuRef} role="menu">
        <button type="button" role="menuitem">
          First
        </button>
        <button type="button" role="menuitem">
          Second
        </button>
      </div>
    </div>
  );
}

let frames: FrameRequestCallback[] = [];

function flushFrame() {
  const callback = frames.shift();
  callback?.(0);
}

beforeEach(() => {
  frames = [];
  refusals = 0;
  focusAttempts = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  HTMLElement.prototype.focus = function focus(this: HTMLElement, ...args: []) {
    if (this.getAttribute?.('role') === 'menuitem') {
      focusAttempts += 1;
      if (refusals > 0) {
        refusals -= 1;
        return;
      }
    }
    return realFocus.apply(this, args);
  };
});

afterEach(() => {
  HTMLElement.prototype.focus = realFocus;
  vi.restoreAllMocks();
});

describe('usemenubar focus retry', () => {
  it('retries the dropdown handoff while the portal layer refuses focus', () => {
    refusals = 2;
    render(<Harness />);

    flushFrame();
    expect(focusAttempts).toBe(1);
    flushFrame();
    expect(focusAttempts).toBe(2);
    flushFrame();
    expect(focusAttempts).toBe(3);
    expect(document.activeElement?.textContent).toBe('First');

    // Focus landed: the retry chain must stop, not keep re-focusing.
    expect(frames.length).toBe(0);
  });

  it('stops retrying once focus moved deliberately elsewhere', () => {
    refusals = Number.POSITIVE_INFINITY;
    render(
      <>
        <button type="button">Outside</button>
        <Harness />
      </>,
    );

    flushFrame();
    expect(focusAttempts).toBe(1);

    const outside = screen.getByText('Outside');
    outside.focus();
    expect(document.activeElement).toBe(outside);

    flushFrame();
    expect(focusAttempts).toBe(2);
    // The next frame must not schedule another attempt: focus is the user's.
    flushFrame();
    expect(focusAttempts).toBe(2);
  });
});
