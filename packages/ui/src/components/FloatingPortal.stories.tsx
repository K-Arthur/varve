import type { Meta, StoryObj } from '@storybook/react';
import { useRef, useState } from 'storybook/preview-api';
import { FloatingPortal } from './FloatingPortal';

const meta: Meta<typeof FloatingPortal> = {
  title: 'Components/FloatingPortal',
  component: FloatingPortal,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof FloatingPortal>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    return (
      <div>
        <button ref={anchorRef} type="button" onClick={() => setOpen(!open)}>
          Toggle Portal
        </button>
        <FloatingPortal anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
          <div
            style={{
              background: 'var(--elevation-surface-default)',
              border: '1px solid var(--color-border-subtle)',
              padding: 16,
              borderRadius: 6,
              minWidth: 200,
            }}
          >
            <p>This content is portaled to document.body.</p>
          </div>
        </FloatingPortal>
      </div>
    );
  },
};

export const MatchAnchorWidth: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    return (
      <div>
        <button ref={anchorRef} type="button" onClick={() => setOpen(!open)} style={{ width: 300 }}>
          Wide Trigger (width matched)
        </button>
        <FloatingPortal
          anchorRef={anchorRef}
          open={open}
          onClose={() => setOpen(false)}
          matchAnchorWidth
        >
          <div
            style={{
              background: 'var(--elevation-surface-default)',
              border: '1px solid var(--color-border-subtle)',
              padding: 16,
              borderRadius: 6,
            }}
          >
            <p>This has the same width as the trigger.</p>
          </div>
        </FloatingPortal>
      </div>
    );
  },
};
