/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingPortal } from './FloatingPortal';

afterEach(() => {
  cleanup();
});

function TestFloatingPortal({ open, onClose }: { open: boolean; onClose?: () => void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={anchorRef}>
        Anchor
      </button>
      <FloatingPortal anchorRef={anchorRef} open={open} onClose={onClose} className="test-float">
        <div role="menu">Menu content</div>
      </FloatingPortal>
    </>
  );
}

describe('FloatingPortal', () => {
  it('portals content to document.body when open', () => {
    render(<TestFloatingPortal open />);
    const float = document.body.querySelector('.test-float');
    expect(float).toBeTruthy();
    expect(float?.parentElement).toBe(document.body);
    expect(float?.querySelector('[role="menu"]')).toBeTruthy();
  });

  it('does not render when closed', () => {
    render(<TestFloatingPortal open={false} />);
    expect(document.body.querySelector('.test-float')).toBeNull();
  });

  it('uses position fixed on the floating layer', () => {
    render(<TestFloatingPortal open />);
    const float = document.body.querySelector('.test-float') as HTMLElement;
    expect(float.style.position).toBe('fixed');
  });

  it('keeps overlays inside a native dialog top layer', () => {
    function DialogFixture() {
      const anchorRef = useRef<HTMLButtonElement>(null);
      return (
        <dialog open>
          <button type="button" ref={anchorRef}>
            Anchor
          </button>
          <FloatingPortal anchorRef={anchorRef} open className="dialog-float">
            <div role="listbox">Dialog menu</div>
          </FloatingPortal>
        </dialog>
      );
    }

    render(<DialogFixture />);
    const float = document.body.querySelector('.dialog-float');
    expect(float?.parentElement?.tagName).toBe('DIALOG');
  });

  it('calls onClose when clicking outside', async () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">Outside</button>
        <TestFloatingPortal open onClose={onClose} />
      </div>,
    );
    await new Promise((r) => requestAnimationFrame(r));
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose when clicking inside the floating layer', async () => {
    const onClose = vi.fn();
    render(<TestFloatingPortal open onClose={onClose} />);
    await new Promise((r) => requestAnimationFrame(r));
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('FloatingPortal positioning', () => {
  it('resolves to visible fixed positioning after layout', async () => {
    render(<TestFloatingPortal open />);
    const panel = document.body.querySelector('.test-float') as HTMLElement;
    expect(panel).toBeTruthy();
    await vi.waitFor(
      () => {
        expect(panel.style.visibility).toBe('visible');
      },
      { timeout: 2000 },
    );
  });
});
