import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { SegmentedControl } from './SegmentedControl';

const meta: Meta<typeof SegmentedControl> = {
  title: 'Components/SegmentedControl',
  component: SegmentedControl,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof SegmentedControl>;

const alignmentOptions = [
  { value: 'left', label: 'Left', icon: 'AlignLeft' as const },
  { value: 'center', label: 'Center', icon: 'AlignCenter' as const },
  { value: 'right', label: 'Right', icon: 'AlignRight' as const },
];

const viewOptions = [
  { value: 'grid', label: 'Grid', icon: 'SquaresFour' as const },
  { value: 'list', label: 'List', icon: 'List' as const },
];

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('center');
    return (
      <SegmentedControl
        label="Alignment"
        value={value}
        options={alignmentOptions}
        onChange={setValue}
      />
    );
  },
};

export const TwoOptions: Story = {
  render: () => {
    const [value, setValue] = useState('grid');
    return (
      <SegmentedControl label="View mode" value={value} options={viewOptions} onChange={setValue} />
    );
  },
};

export const Disabled: Story = {
  render: () => {
    const [value, setValue] = useState('center');
    return (
      <SegmentedControl
        label="Alignment"
        value={value}
        options={alignmentOptions}
        onChange={setValue}
        disabled
      />
    );
  },
};

export const Dark: Story = {
  render: () => {
    const [value, setValue] = useState('left');
    return (
      <SegmentedControl
        label="Alignment"
        value={value}
        options={alignmentOptions}
        onChange={setValue}
      />
    );
  },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
