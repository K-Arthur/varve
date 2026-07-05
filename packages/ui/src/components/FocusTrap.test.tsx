import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { FocusTrap } from './FocusTrap';

function TestDialog({ onClose }: { onClose: () => void }) {
  return (
    <FocusTrap>
      <div role="dialog" aria-modal="true" aria-label="Test">
        <button type="button" data-testid="first">
          First
        </button>
        <button type="button" data-testid="middle">
          Middle
        </button>
        <button type="button" data-testid="last">
          Last
        </button>
        <button type="button" data-testid="close" onClick={onClose}>
          Close
        </button>
      </div>
    </FocusTrap>
  );
}

function WithInitialFocus() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <FocusTrap initialFocus="#focus-target">
          <div role="dialog" aria-modal="true" aria-label="With initial">
            <button type="button" data-testid="first">
              First
            </button>
            <input data-testid="focus-target" id="focus-target" />
            <button type="button" data-testid="last">
              Last
            </button>
          </div>
        </FocusTrap>
      )}
    </div>
  );
}

describe('FocusTrap', () => {
  it('wraps Tab from last to first focusable element', () => {
    render(<TestDialog onClose={() => {}} />);
    const first = screen.getByTestId('first');
    const last = screen.getByTestId('last');
    first.focus();

    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from first to last focusable element', () => {
    render(<TestDialog onClose={() => {}} />);
    const first = screen.getByTestId('first');
    const last = screen.getByTestId('last');
    last.focus();

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('focuses initialFocus element when specified', async () => {
    render(<WithInitialFocus />);
    fireEvent.click(screen.getByTestId('opener'));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('focus-target'));
    });
  });
});
