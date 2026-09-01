import type { Meta, StoryObj } from '@storybook/react';
import { Toast } from './Toast';
import { ToastProvider, useToast } from './ToastProvider';

const meta: Meta<typeof Toast> = {
  title: 'Components/Toast',
  component: Toast,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof Toast>;

const dummyDismiss = () => {};

export const Info: Story = {
  args: {
    toast: { id: '1', message: 'Document saved successfully.', type: 'info' },
    onDismiss: dummyDismiss,
  },
};

export const Success: Story = {
  args: {
    toast: { id: '2', message: 'Changes published.', type: 'success' },
    onDismiss: dummyDismiss,
  },
};

export const Warning: Story = {
  args: {
    toast: { id: '3', message: 'Storage is almost full.', type: 'warning' },
    onDismiss: dummyDismiss,
  },
};

export const ErrorToast: Story = {
  args: {
    toast: { id: '4', message: 'Failed to export PDF. Please try again.', type: 'error' },
    onDismiss: dummyDismiss,
  },
};

function ToastDemo() {
  const { toast } = useToast();
  return (
    <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'flex-start' }}>
      <button
        type="button"
        className="varve-btn varve-btn--primary"
        onClick={() => toast({ message: 'Info toast', type: 'info' })}
      >
        Show Info
      </button>
      <button
        type="button"
        className="varve-btn varve-btn--secondary"
        onClick={() => toast({ message: 'Success toast', type: 'success' })}
      >
        Show Success
      </button>
      <button
        type="button"
        className="varve-btn varve-btn--ghost"
        onClick={() => toast({ message: 'Warning toast', type: 'warning' })}
      >
        Show Warning
      </button>
      <button
        type="button"
        className="varve-btn varve-btn--danger"
        onClick={() => toast({ message: 'Error toast', type: 'error' })}
      >
        Show Error
      </button>
      <button
        type="button"
        className="varve-btn varve-btn--ghost"
        onClick={() => toast.loading({ message: 'Preparing preview…', id: 'preview:fixture' })}
      >
        Show Loading
      </button>
      <button
        type="button"
        className="varve-btn varve-btn--ghost"
        onClick={() =>
          toast.update('preview:fixture', { message: 'Preview ready', type: 'success' })
        }
      >
        Complete Loading
      </button>
      <button
        type="button"
        className="varve-btn varve-btn--secondary"
        onClick={() =>
          toast({
            title: 'Layer deleted',
            message: 'The layer can be restored from history.',
            type: 'success',
            action: { label: 'Undo', onClick: () => {} },
          })
        }
      >
        Show Undo
      </button>
      <button
        type="button"
        className="varve-btn varve-btn--danger"
        onClick={() =>
          toast.error({
            title: 'Export failed',
            message: 'Unable to write PDF. Check the destination and try again.',
            action: {
              label: 'Retry',
              onClick: () => void toast.loading({ message: 'Retrying…', id: 'export:fixture' }),
            },
            cancelAction: { label: 'Details', onClick: () => {}, dismiss: false },
          })
        }
      >
        Show Actions
      </button>
      <button
        type="button"
        className="varve-btn varve-btn--ghost"
        onClick={() => {
          for (let i = 1; i <= 8; i += 1)
            toast.info({ message: `Imported asset ${i}`, dedupeKey: `asset:${i}` });
        }}
      >
        Burst 8
      </button>
    </div>
  );
}

export const Interactive: Story = {
  render: () => (
    <ToastProvider>
      <ToastDemo />
    </ToastProvider>
  ),
};

export const Dark: Story = {
  args: {
    toast: { id: '5', message: 'Dark theme toast', type: 'info' },
    onDismiss: dummyDismiss,
  },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px' }}>
        <Story />
      </div>
    ),
  ],
};

export const DevelopmentFixture: Story = {
  render: () => (
    <ToastProvider>
      <div style={{ minHeight: '32rem', padding: '24px', background: 'var(--color-surface-app)' }}>
        <ToastDemo />
      </div>
    </ToastProvider>
  ),
};
