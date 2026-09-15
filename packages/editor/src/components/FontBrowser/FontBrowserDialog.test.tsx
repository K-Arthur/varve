// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FontBrowserDialog } from './FontBrowserDialog';

vi.mock('./FontBrowser', () => ({
  FontBrowser: () => <button type="button">font browser content</button>,
}));

afterEach(cleanup);

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

describe('FontBrowserDialog', () => {
  it('dismisses on Escape even when focus belongs to another modal surface', () => {
    const onClose = vi.fn();
    render(<FontBrowserDialog open onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape', bubbles: true, cancelable: true });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
