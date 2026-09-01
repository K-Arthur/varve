/**
 * Toast notification component tests.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
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
      const countRef = useRef(0);
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
    expect(screen.getByRole('button', { name: /show 2 more notifications/i })).toBeInTheDocument();
  });

  it('uses the shared loading spinner and updates a promise in place', async () => {
    function PromiseTrigger() {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            void toast.promise(Promise.resolve(true), {
              id: 'export:1',
              loading: 'Exporting…',
              success: 'PDF exported',
              error: 'Export failed',
            });
          }}
        >
          Export
        </button>
      );
    }
    renderWithProvider(<PromiseTrigger />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Export'));
    await waitFor(() => expect(screen.getByText('PDF exported')).toBeInTheDocument());
    expect(screen.queryByText('Exporting…')).not.toBeInTheDocument();
  });

  it('deduplicates an in-flight operation by stable key', async () => {
    function DuplicateTrigger() {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() => toast.loading({ message: 'Rendering…', dedupeKey: 'render:1' })}
        >
          Render
        </button>
      );
    }
    renderWithProvider(<DuplicateTrigger />);
    const user = userEvent.setup();
    const button = screen.getByText('Render');
    await user.click(button);
    await user.click(button);
    expect(screen.getAllByText('Rendering…')).toHaveLength(1);
  });

  it('aggregates repeated events with the same key', async () => {
    function AggregateTrigger() {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() =>
            toast.info({ message: 'Assets imported', dedupeKey: 'import', aggregate: true })
          }
        >
          Import
        </button>
      );
    }
    renderWithProvider(<AggregateTrigger />);
    const user = userEvent.setup();
    const button = screen.getByText('Import');
    await user.click(button);
    await user.click(button);
    await user.click(button);
    expect(screen.getByText('Assets imported (3)')).toBeInTheDocument();
  });

  it('runs an action and dismisses by default', async () => {
    let actionCount = 0;
    function ActionTrigger() {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() =>
            toast({
              message: 'Layer deleted',
              type: 'success',
              action: {
                label: 'Undo',
                onClick: () => {
                  actionCount += 1;
                },
              },
            })
          }
        >
          Delete
        </button>
      );
    }
    renderWithProvider(<ActionTrigger />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Delete'));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actionCount).toBe(1);
    await waitFor(() => expect(screen.queryByText('Layer deleted')).not.toBeInTheDocument());
  });

  it('dismisses all visible and queued notifications', async () => {
    function BurstTrigger() {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            for (let i = 0; i < 5; i += 1) toast({ message: `Burst ${i}`, duration: undefined });
          }}
        >
          Burst
        </button>
      );
    }
    function DismissAll() {
      const { toast } = useToast();
      return (
        <button type="button" onClick={toast.dismissAll}>
          Clear
        </button>
      );
    }
    renderWithProvider(
      <>
        <BurstTrigger />
        <DismissAll />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText('Burst'));
    expect(screen.getByText('Burst 0')).toBeInTheDocument();
    await user.click(screen.getByText('Clear'));
    expect(screen.queryByText('Burst 0')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /show .* more notifications/i }),
    ).not.toBeInTheDocument();
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
