/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleInitialNameSelection } from './initialNameSelection';

let dialog: HTMLDialogElement;
let input: HTMLInputElement;
let openingFrame: FrameRequestCallback;

beforeEach(() => {
  dialog = document.createElement('dialog');
  dialog.open = true;
  input = document.createElement('input');
  input.value = 'Untitled 1';
  dialog.append(input);
  document.body.append(dialog);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    openingFrame = callback;
    return 17;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  dialog.remove();
  vi.restoreAllMocks();
});

describe('initial document name selection', () => {
  it('focuses and selects the untouched suggestion once', () => {
    scheduleInitialNameSelection(input, 'Untitled 1');
    openingFrame(100);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it.each(['pointerdown', 'keydown', 'beforeinput', 'input'])(
    'leaves an interaction underway alone after %s',
    (event) => {
      scheduleInitialNameSelection(input, 'Untitled 1');
      input.focus();
      input.setSelectionRange(2, 2);
      input.dispatchEvent(new Event(event, { bubbles: true }));
      openingFrame(100);
      expect(window.cancelAnimationFrame).toHaveBeenCalledWith(17);
      expect(input.selectionStart).toBe(2);
      expect(input.selectionEnd).toBe(2);
    },
  );

  it('does not steal focus from another dialog control', () => {
    const button = document.createElement('button');
    dialog.append(button);
    scheduleInitialNameSelection(input, 'Untitled 1');
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    button.focus();
    openingFrame(100);
    expect(button).toHaveFocus();
  });

  it('leaves a changed value and caret alone even without an input event', () => {
    scheduleInitialNameSelection(input, 'Untitled 1');
    input.value = 'M';
    input.setSelectionRange(1, 1);
    openingFrame(100);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
  });

  it('cancels on cleanup even if the stale callback is delivered', () => {
    const cancel = scheduleInitialNameSelection(input, 'Untitled 1');
    cancel();
    openingFrame(100);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(input).not.toHaveFocus();
  });

  it('does not focus a closed dialog', () => {
    scheduleInitialNameSelection(input, 'Untitled 1');
    dialog.open = false;
    openingFrame(100);
    expect(input).not.toHaveFocus();
  });

  it('does not focus a detached dialog', () => {
    scheduleInitialNameSelection(input, 'Untitled 1');
    dialog.remove();
    openingFrame(100);
    expect(input).not.toHaveFocus();
  });
});
