import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';
import { Popover } from './Popover';

const meta: Meta<typeof Popover> = {
  title: 'Components/Popover',
  component: Popover,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    placement: { control: 'select', options: ['top', 'bottom', 'left', 'right'] },
  },
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Default: Story = {
  args: {
    placement: 'bottom',
    children: <Button variant="primary">Open Popover</Button>,
    popover: (
      <div style={{ padding: '8px', minWidth: '160px' }}>
        <p style={{ margin: '0 0 8px', fontSize: '14px' }}>Popover content here.</p>
        <Button variant="secondary" size="sm">
          Action
        </Button>
      </div>
    ),
  },
};

export const TopPlacement: Story = {
  args: {
    placement: 'top',
    children: <Button variant="secondary">Top Popover</Button>,
    popover: (
      <div style={{ padding: '8px', minWidth: '160px' }}>
        <p style={{ margin: '0' }}>Placed on top.</p>
      </div>
    ),
  },
};

export const Dark: Story = {
  args: {
    placement: 'bottom',
    children: <Button variant="primary">Dark Popover</Button>,
    popover: (
      <div style={{ padding: '8px', minWidth: '160px' }}>
        <p style={{ margin: '0' }}>Dark theme popover.</p>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '200px' }}>
        <Story />
      </div>
    ),
  ],
};
