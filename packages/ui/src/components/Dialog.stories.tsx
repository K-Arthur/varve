import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { AlertDialog, Dialog } from './Dialog';

const meta: Meta<typeof Dialog> = {
  title: 'Components/Dialog',
  component: Dialog,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          className="varve-btn varve-btn--primary"
          onClick={() => setOpen(true)}
        >
          Open Dialog
        </button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Example Dialog">
          <p>This is the dialog body content.</p>
        </Dialog>
      </>
    );
  },
};

export const Alert: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" className="varve-btn varve-btn--danger" onClick={() => setOpen(true)}>
          Delete Item
        </button>
        <AlertDialog
          open={open}
          onClose={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
          title="Confirm deletion"
          description="This action cannot be undone."
          variant="danger"
          confirmLabel="Delete"
        />
      </>
    );
  },
};
