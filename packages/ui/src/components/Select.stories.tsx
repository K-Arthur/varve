import { useState } from 'storybook/preview-api';
import type { Meta, StoryObj } from '@storybook/react';
import { Select } from './Select';

const fruitOptions = Array.from({ length: 25 }, (_, i) => ({
  value: `fruit-${i}`,
  label: `Fruit Option ${i + 1}`,
}));

const meta: Meta<typeof Select> = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    searchable: { control: 'boolean' },
    disabled: { control: 'boolean' },
    error: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Basic: Story = {
  render: () => {
    const [value, setValue] = useState('option-1');
    const options = [
      { value: 'option-1', label: 'Option 1' },
      { value: 'option-2', label: 'Option 2' },
      { value: 'option-3', label: 'Option 3' },
    ];
    return <Select options={options} value={value} onChange={setValue} label="Basic select" />;
  },
};

export const WithError: Story = {
  render: () => {
    const [value, setValue] = useState('');
    const options = [
      { value: 'option-1', label: 'Option 1' },
      { value: 'option-2', label: 'Option 2' },
    ];
    return (
      <Select
        options={options}
        value={value}
        onChange={setValue}
        label="Select with error"
        error="This field is required"
      />
    );
  },
};

export const Disabled: Story = {
  render: () => {
    const [value, setValue] = useState('option-1');
    const options = [
      { value: 'option-1', label: 'Option 1' },
      { value: 'option-2', label: 'Option 2' },
    ];
    return (
      <Select
        options={options}
        value={value}
        onChange={setValue}
        label="Disabled select"
        disabled
      />
    );
  },
};

export const Searchable: Story = {
  render: () => {
    const [value, setValue] = useState('fruit-0');
    return (
      <Select
        options={fruitOptions}
        value={value}
        onChange={setValue}
        label="Searchable select"
        searchable
      />
    );
  },
};

export const Dark: Story = {
  render: () => {
    const [value, setValue] = useState('option-1');
    const options = [
      { value: 'option-1', label: 'Option 1' },
      { value: 'option-2', label: 'Option 2' },
    ];
    return <Select options={options} value={value} onChange={setValue} label="Dark select" />;
  },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
