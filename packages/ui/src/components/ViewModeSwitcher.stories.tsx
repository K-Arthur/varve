import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { ViewModeSwitcher } from './ViewModeSwitcher';

const meta: Meta<typeof ViewModeSwitcher> = {
  title: 'Components/ViewModeSwitcher',
  component: ViewModeSwitcher,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof ViewModeSwitcher>;

const viewOptions = [
  { value: 'grid', label: 'Grid', icon: 'SquaresFour' as const },
  { value: 'list', label: 'List', icon: 'List' as const },
  { value: 'details', label: 'Details', icon: 'Info' as const },
];

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('grid');
    return (
      <ViewModeSwitcher label="View mode" value={value} options={viewOptions} onChange={setValue} />
    );
  },
};

export const Disabled: Story = {
  render: () => {
    const [value, setValue] = useState('list');
    return (
      <ViewModeSwitcher
        label="View mode"
        value={value}
        options={viewOptions}
        onChange={setValue}
        disabled
      />
    );
  },
};

export const Dark: Story = {
  render: () => {
    const [value, setValue] = useState('details');
    return (
      <ViewModeSwitcher label="View mode" value={value} options={viewOptions} onChange={setValue} />
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
