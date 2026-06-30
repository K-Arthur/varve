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
      <button type="button" className="strata-btn strata-btn--primary" onClick={() => toast({ message: 'Info toast', type: 'info' })}>
        Show Info
      </button>
      <button type="button" className="strata-btn strata-btn--secondary" onClick={() => toast({ message: 'Success toast', type: 'success' })}>
        Show Success
      </button>
      <button type="button" className="strata-btn strata-btn--ghost" onClick={() => toast({ message: 'Warning toast', type: 'warning' })}>
        Show Warning
      </button>
      <button type="button" className="strata-btn strata-btn--danger" onClick={() => toast({ message: 'Error toast', type: 'error' })}>
        Show Error
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
