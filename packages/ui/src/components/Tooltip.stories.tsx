import type { Meta, StoryObj } from '@storybook/react';
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
    children: (
      <button type="button" className="strata-btn strata-btn--primary">
        Hover me
      </button>
    ),
  },
};

export const Bottom: Story = {
  args: {
    label: 'Tooltip on bottom',
    placement: 'bottom',
    children: (
      <button type="button" className="strata-btn strata-btn--secondary">
        Hover me
      </button>
    ),
  },
};

export const Left: Story = {
  args: {
    label: 'Tooltip on left',
    placement: 'left',
    children: (
      <button type="button" className="strata-btn strata-btn--ghost">
        Hover me
      </button>
    ),
  },
};

export const Right: Story = {
  args: {
    label: 'Tooltip on right',
    placement: 'right',
    children: (
      <button type="button" className="strata-btn strata-btn--danger">
        Hover me
      </button>
    ),
  },
};

export const LongLabel: Story = {
  args: {
    label:
      'This is a longer tooltip label that demonstrates text wrapping and max-width constraints.',
    placement: 'top',
    children: (
      <button type="button" className="strata-btn strata-btn--primary">
        Long tooltip
      </button>
    ),
  },
};

export const Dark: Story = {
  args: {
    label: 'Dark theme tooltip',
    placement: 'top',
    children: (
      <button type="button" className="strata-btn strata-btn--primary">
        Hover me
      </button>
    ),
  },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
