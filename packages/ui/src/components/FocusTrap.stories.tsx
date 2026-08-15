import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { FocusTrap } from './FocusTrap';

const meta: Meta<typeof FocusTrap> = {
  title: 'Components/FocusTrap',
  component: FocusTrap,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    active: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof FocusTrap>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Open Trap
        </button>
        {open && (
          <div
            style={{
              border: '1px solid var(--color-border)',
              padding: 16,
              marginTop: 8,
              borderRadius: 6,
            }}
          >
            <FocusTrap active onClose={() => setOpen(false)}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label>
                  Name: <input type="text" />
                </label>
                <label>
                  Email: <input type="email" />
                </label>
                <button type="button" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </FocusTrap>
          </div>
        )}
      </div>
    );
  },
};

export const Inactive: Story = {
  render: () => (
    <FocusTrap active={false}>
      <div>
        <button type="button">Button 1</button>
        <button type="button">Button 2</button>
        <button type="button">Button 3</button>
      </div>
    </FocusTrap>
  ),
};
