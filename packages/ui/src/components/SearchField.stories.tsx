import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { SearchField } from './SearchField';

const meta: Meta<typeof SearchField> = {
  title: 'Components/SearchField',
  component: SearchField,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof SearchField>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return <SearchField value={value} onChange={setValue} placeholder="Search files..." />;
  },
};

export const WithValue: Story = {
  render: () => {
    const [value, setValue] = useState('design');
    return <SearchField value={value} onChange={setValue} placeholder="Search files..." />;
  },
};

export const WithResultCount: Story = {
  render: () => {
    const [value, setValue] = useState('button');
    return (
      <SearchField
        value={value}
        onChange={setValue}
        resultCount={3}
        placeholder="Search components..."
      />
    );
  },
};

export const Disabled: Story = {
  args: { value: '', onChange: () => {}, disabled: true, placeholder: 'Search disabled...' },
};

export const Dark: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return <SearchField value={value} onChange={setValue} placeholder="Search files..." />;
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
