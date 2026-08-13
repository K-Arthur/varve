import { useState } from 'storybook/preview-api';
import type { Meta, StoryObj } from '@storybook/react';
import { RadioGroup } from './Radio';

const meta: Meta<typeof RadioGroup> = {
  title: 'Components/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    orientation: { control: 'select', options: ['horizontal', 'vertical'] },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof RadioGroup>;

const sizeOptions = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

const colorOptions = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
];

export const Vertical: Story = {
  render: () => {
    const [value, setValue] = useState('md');
    return (
      <RadioGroup
        label="Size"
        value={value}
        options={sizeOptions}
        onChange={setValue}
        orientation="vertical"
      />
    );
  },
};

export const Horizontal: Story = {
  render: () => {
    const [value, setValue] = useState('green');
    return (
      <RadioGroup
        label="Color"
        value={value}
        options={colorOptions}
        onChange={setValue}
        orientation="horizontal"
      />
    );
  },
};

export const Disabled: Story = {
  render: () => {
    const [value, setValue] = useState('md');
    return (
      <RadioGroup label="Size" value={value} options={sizeOptions} onChange={setValue} disabled />
    );
  },
};

export const WithDisabledOption: Story = {
  render: () => {
    const [value, setValue] = useState('sm');
    const mixedOptions = [
      { value: 'xs', label: 'Extra Small' },
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Medium', disabled: true },
      { value: 'lg', label: 'Large' },
    ];
    return <RadioGroup label="Size" value={value} options={mixedOptions} onChange={setValue} />;
  },
};

export const Dark: Story = {
  render: () => {
    const [value, setValue] = useState('md');
    return <RadioGroup label="Size" value={value} options={sizeOptions} onChange={setValue} />;
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
