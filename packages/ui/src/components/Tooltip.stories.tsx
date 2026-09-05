import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Components/Tooltip',
  component: Tooltip,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    placement: { control: 'select', options: ['top', 'bottom', 'left', 'right'] },
    delay: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Top: Story = {
  args: {
    label: 'Tooltip on top',
    placement: 'top',
    children: <Button>Hover me</Button>,
  },
};

export const Bottom: Story = {
  args: {
    label: 'Tooltip on bottom',
    placement: 'bottom',
    children: <Button variant="secondary">Hover me</Button>,
  },
};

export const Left: Story = {
  args: {
    label: 'Tooltip on left',
    placement: 'left',
    children: <Button variant="ghost">Hover me</Button>,
  },
};

export const Right: Story = {
  args: {
    label: 'Tooltip on right',
    placement: 'right',
    children: <Button variant="destructive">Hover me</Button>,
  },
};

export const LongLabel: Story = {
  args: {
    label:
      'This is a longer tooltip label that demonstrates text wrapping and max-width constraints.',
    placement: 'top',
    children: <Button>Long tooltip</Button>,
  },
};

export const Dark: Story = {
  args: {
    label: 'Dark theme tooltip',
    placement: 'top',
    children: <Button>Hover me</Button>,
  },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
