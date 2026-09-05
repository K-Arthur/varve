/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOverlaySnapshot,
  getOverlayTrace,
  registerOverlay,
  setOverlayDebugEnabled,
} from './OverlayRegistry';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  setOverlayDebugEnabled(document, false);
});

function register(
  id: string,
  node: HTMLElement,
  options: Partial<Parameters<typeof registerOverlay>[0]> = {},
) {
  const cleanup = registerOverlay({
    id,
    kind: options.kind ?? 'popover',
    ownerDocument: document,
    portalRoot: document.body,
    node,
    dismissOnPointerDown: true,
    dismissOnEscape: true,
    ...options,
  });
  cleanups.push(cleanup);
  return cleanup;
}

function pointerDown(target: EventTarget): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

describe('overlay registry', () => {
  it('treats a portaled descendant as inside its parent tree', () => {
    const parent = document.createElement('div');
    const child = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(parent, child, outside);
    const parentClose = vi.fn();
    const childClose = vi.fn();
    register('parent', parent, { onClose: parentClose });
    register('child', child, { parentId: 'parent', onClose: childClose });

    pointerDown(child);
    expect(parentClose).not.toHaveBeenCalled();
    expect(childClose).not.toHaveBeenCalled();

    pointerDown(parent);
    expect(parentClose).not.toHaveBeenCalled();
    expect(childClose).toHaveBeenCalledWith('outside-pointer');

    pointerDown(outside);
    expect(parentClose).toHaveBeenCalledWith('outside-pointer');
  });

  it('closes a complete tree deepest-first when its root is outside', () => {
    const root = document.createElement('div');
    const child = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(root, child, outside);
    const order: string[] = [];
    register('root', root, { onClose: (reason) => order.push(`root:${reason}`) });
    register('child', child, {
      parentId: 'root',
      onClose: (reason) => order.push(`child:${reason}`),
    });

    pointerDown(outside);

    expect(order).toEqual(['child:parent-close', 'root:outside-pointer']);
  });

  it('dismisses only the deepest focused overlay on Escape', () => {
    const root = document.createElement('div');
    const child = document.createElement('button');
    document.body.append(root, child);
    const rootClose = vi.fn();
    const childClose = vi.fn();
    register('root-escape', root, { onClose: rootClose });
    register('child-escape', child, {
      parentId: 'root-escape',
      onClose: childClose,
    });
    child.focus();

    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(childClose).toHaveBeenCalledWith('escape');
    expect(rootClose).not.toHaveBeenCalled();
  });

  it('removes the owner-document listeners and registration exactly once', () => {
    const node = document.createElement('div');
    document.body.append(node);
    const cleanup = register('single', node);
    expect(getOverlaySnapshot(document)).toHaveLength(1);
    cleanup();
    cleanup();
    expect(getOverlaySnapshot(document)).toEqual([]);
  });

  it('replaces a conflicting root menu and closes its descendants', () => {
    const first = document.createElement('div');
    const firstChild = document.createElement('div');
    const second = document.createElement('div');
    document.body.append(first, firstChild, second);
    const firstClose = vi.fn();
    const firstChildClose = vi.fn();
    const secondClose = vi.fn();
    register('first-menu', first, {
      kind: 'action-menu',
      onClose: firstClose,
    });
    register('first-menu-child', firstChild, {
      kind: 'submenu',
      parentId: 'first-menu',
      onClose: firstChildClose,
    });
    register('second-menu', second, {
      kind: 'context-menu',
      onClose: secondClose,
    });

    expect(firstChildClose).toHaveBeenCalledWith('parent-close');
    expect(firstClose).toHaveBeenCalledWith('open-sibling');
    expect(secondClose).not.toHaveBeenCalled();
  });

  it('invokes each outside close callback at most once before React unmounts', () => {
    const node = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(node, outside);
    const close = vi.fn();
    register('close-once', node, { onClose: close });

    pointerDown(outside);
    pointerDown(outside);

    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps a bounded development trace for geometry/event diagnostics', () => {
    const node = document.createElement('div');
    document.body.append(node);
    setOverlayDebugEnabled(document, true);
    register('trace', node);
    pointerDown(document.body);
    const trace = getOverlayTrace(document);

    expect(trace.some((entry) => entry.event === 'registered')).toBe(true);
    expect(trace.some((entry) => entry.event === 'outside-event')).toBe(true);
  });

  it('keeps debug mode when an empty registry is recreated after cleanup', () => {
    const node = document.createElement('div');
    document.body.append(node);
    setOverlayDebugEnabled(document, true);
    const cleanup = register('debug-restart', node);
    cleanup();

    const next = document.createElement('div');
    document.body.append(next);
    register('debug-restart-next', next);
    expect(getOverlayTrace(document).some((entry) => entry.event === 'registered')).toBe(true);
  });
});
