import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Tooltip } from './Tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Components/Tooltip',
  component: Tooltip,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    placement: { control: 'select', options: ['top', 'bottom', 'left', 'right'] },
    delay: { control: 'number' },
    tone: { control: 'select', options: ['default', 'warning', 'danger'] },
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

export const WithShortcut: Story = {
  args: {
    label: 'Select',
    shortcut: 'V',
    placement: 'top',
    children: <Button variant="ghost">Select tool</Button>,
  },
};

export const DisabledReason: Story = {
  args: {
    label: 'Boolean',
    disabledReason: 'Select 2+ closed, unlocked vector shapes',
    placement: 'top',
    children: <Button disabled>Boolean</Button>,
  },
};

export const WarningTone: Story = {
  args: {
    label: 'Overlapping layers may produce unexpected blending',
    tone: 'warning',
    placement: 'top',
    children: <Button variant="secondary">Blend layers</Button>,
  },
};

export const DangerTone: Story = {
  args: {
    label: 'This will permanently delete all hidden layers',
    tone: 'danger',
    placement: 'top',
    children: <Button variant="destructive">Delete hidden</Button>,
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

export const ToolbarSequence: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 4 }}>
      <Tooltip label="Select" shortcut="V">
        <IconButton label="Select" icon="MousePointer2" />
      </Tooltip>
      <Tooltip label="Rectangle" shortcut="R">
        <IconButton label="Rectangle" icon="Square" />
      </Tooltip>
      <Tooltip label="Ellipse" shortcut="O">
        <IconButton label="Ellipse" icon="Circle" />
      </Tooltip>
      <Tooltip label="Pen" shortcut="P">
        <IconButton label="Pen" icon="Pen" />
      </Tooltip>
    </div>
  ),
};
