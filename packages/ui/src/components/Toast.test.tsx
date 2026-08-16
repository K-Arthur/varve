/**
 * Toast notification component tests.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToastItem } from './Toast';
import { ToastProvider, useToast } from './ToastProvider';

function ToastTrigger({ toastItem }: { toastItem: Omit<ToastItem, 'id'> }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(toastItem)}>
      Show Toast
    </button>
  );
}

function renderWithProvider(component: React.ReactNode) {
  return render(<ToastProvider>{component}</ToastProvider>);
}

afterEach(cleanup);

describe('Toast', () => {
  it('renders toast with message', async () => {
    renderWithProvider(<ToastTrigger toastItem={{ message: 'Hello World' }} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('info toast has role="status"', async () => {
    renderWithProvider(<ToastTrigger toastItem={{ message: 'Info', type: 'info' }} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Show Toast'));
    expect(screen.getByRole('status')).toHaveTextContent('Info');
  });

  it('error toast has role="alert"', async () => {
    renderWithProvider(<ToastTrigger toastItem={{ message: 'Error!', type: 'error' }} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Show Toast'));
    expect(screen.getByRole('alert')).toHaveTextContent('Error!');
  });

  it('shows close button with accessible label', async () => {
    renderWithProvider(<ToastTrigger toastItem={{ message: 'Close me' }} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Show Toast'));
    expect(screen.getByLabelText('Dismiss notification')).toBeInTheDocument();
  });

  it('toast auto-dismisses after duration', async () => {
    renderWithProvider(<ToastTrigger toastItem={{ message: 'Auto', duration: 1000 }} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Auto')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Auto')).not.toBeInTheDocument(), {
      timeout: 3000,
    });
  }, 10000);

  it('toast does not auto-dismiss on hover', async () => {
    renderWithProvider(<ToastTrigger toastItem={{ message: 'Hover', duration: 1000 }} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Show Toast'));
    const toastEl = screen.getByText('Hover').closest('.varve-toast');
    expect(toastEl).toBeTruthy();
    if (!toastEl) return;
    fireEvent.mouseEnter(toastEl);
    await new Promise((r) => setTimeout(r, 2000));
    expect(screen.getByText('Hover')).toBeInTheDocument();
    fireEvent.mouseLeave(toastEl);
    await waitFor(() => expect(screen.queryByText('Hover')).not.toBeInTheDocument(), {
      timeout: 3000,
    });
  }, 10000);

  it('max 3 visible toasts, queues excess', async () => {
    function UniqueToastTrigger() {
      const { toast } = useToast();
      const countRef = { current: 0 };
      return (
        <button
          type="button"
          onClick={() => {
            countRef.current += 1;
            toast({ message: `Toast ${countRef.current}` });
          }}
        >
          Show Toast
        </button>
      );
    }
    renderWithProvider(<UniqueToastTrigger />);
    const user = userEvent.setup();
    const btn = screen.getByText('Show Toast');
    for (let i = 0; i < 5; i++) {
      await user.click(btn);
    }
    // Only 3 visible at a time (queued toasts are not in DOM)
    const toasts = screen.getAllByText(/Toast \d/);
    expect(toasts).toHaveLength(3);
  });

  it('ToastProvider provides context for useToast()', () => {
    function TestComponent() {
      const { toast } = useToast();
      expect(typeof toast).toBe('function');
      return null;
    }
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>,
    );
  });
});
