import { describe, expect, it } from 'vitest';
import {
  keyboardPanDelta,
  shouldDeferArrowToSelectedGuide,
  shouldResolveHover,
  shouldSkipCanvasKeydown,
  shouldSuppressMiddleButtonPaste,
} from './inputPipeline';

describe('explicit keyboard pan policy', () => {
  it('maps arrows to CSS-pixel camera travel without zoom scaling', () => {
    expect(keyboardPanDelta('ArrowRight')).toEqual({ dx: -48, dy: 0 });
    expect(keyboardPanDelta('ArrowUp')).toEqual({ dx: 0, dy: 48 });
    expect(keyboardPanDelta('ArrowLeft', true)).toEqual({ dx: 192, dy: 0 });
    expect(keyboardPanDelta('ArrowDown', true)).toEqual({ dx: 0, dy: -192 });
  });

  it('does not claim non-navigation keys', () => {
    expect(keyboardPanDelta('Enter')).toBeNull();
  });
});

describe('middle-button PRIMARY paste guard', () => {
  it('suppresses unowned canvas paste but preserves editable clipboard targets', () => {
    const textInput = document.createElement('input');
    textInput.type = 'text';
    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    const textArea = document.createElement('textarea');
    const contentEditable = document.createElement('div');
    contentEditable.setAttribute('contenteditable', 'true');
    const nonEditable = document.createElement('button');

    expect(shouldSuppressMiddleButtonPaste(true, document.body)).toBe(true);
    expect(shouldSuppressMiddleButtonPaste(true, textInput)).toBe(false);
    expect(shouldSuppressMiddleButtonPaste(true, numberInput)).toBe(false);
    expect(shouldSuppressMiddleButtonPaste(true, textArea)).toBe(false);
    expect(shouldSuppressMiddleButtonPaste(true, contentEditable)).toBe(false);
    expect(shouldSuppressMiddleButtonPaste(true, nonEditable)).toBe(true);
    expect(shouldSuppressMiddleButtonPaste(false, document.body)).toBe(false);
  });

  it('does not exempt disabled or read-only text fields from the guard', () => {
    const disabledInput = document.createElement('input');
    disabledInput.disabled = true;
    const readOnlyTextArea = document.createElement('textarea');
    readOnlyTextArea.readOnly = true;

    expect(shouldSuppressMiddleButtonPaste(true, disabledInput)).toBe(true);
    expect(shouldSuppressMiddleButtonPaste(true, readOnlyTextArea)).toBe(true);
  });
});

describe('canvas input hover policy', () => {
  it('resolves hover only for idle select and inspect pointers', () => {
    expect(shouldResolveHover('select', 0)).toBe(true);
    expect(shouldResolveHover('inspect', 0)).toBe(true);
    expect(shouldResolveHover('select', 1)).toBe(false);
    expect(shouldResolveHover('inspect', 2)).toBe(false);
    expect(shouldResolveHover('paint', 0)).toBe(false);
  });
});

describe('canvas keydown ownership and IME guards', () => {
  it('skips keydowns already handled by an owning interaction', () => {
    expect(shouldSkipCanvasKeydown({ defaultPrevented: true })).toBe(true);
  });

  it('skips keydowns while the IME is composing', () => {
    expect(shouldSkipCanvasKeydown({ isComposing: true })).toBe(true);
    expect(shouldSkipCanvasKeydown({ isComposing: true, keyCode: 65 })).toBe(true);
  });

  it('skips the keyCode 229 sentinel some engines report instead', () => {
    expect(shouldSkipCanvasKeydown({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(shouldSkipCanvasKeydown({ keyCode: 229 })).toBe(true);
  });

  it('lets ordinary keydowns through', () => {
    expect(shouldSkipCanvasKeydown({ isComposing: false, keyCode: 32 })).toBe(false);
    expect(shouldSkipCanvasKeydown({})).toBe(false);
  });
});

describe('selected guide keyboard priority', () => {
  it('defers bare and Shift arrows from the generic Select tool to the guide controller', () => {
    expect(
      shouldDeferArrowToSelectedGuide({
        key: 'ArrowRight',
        selectedGuideId: 'guide-1',
        activeToolId: 'select',
      }),
    ).toBe(true);
  });

  it('keeps modifier shortcuts and modal tools with their owning input context', () => {
    expect(
      shouldDeferArrowToSelectedGuide({
        key: 'ArrowRight',
        selectedGuideId: 'guide-1',
        activeToolId: 'select',
        ctrlKey: true,
      }),
    ).toBe(false);
    expect(
      shouldDeferArrowToSelectedGuide({
        key: 'ArrowRight',
        selectedGuideId: 'guide-1',
        activeToolId: 'crop',
      }),
    ).toBe(false);
    expect(
      shouldDeferArrowToSelectedGuide({
        key: 'ArrowRight',
        selectedGuideId: null,
        activeToolId: 'select',
      }),
    ).toBe(false);
  });
});
