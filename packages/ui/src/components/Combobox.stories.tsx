import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { Combobox } from './Combobox';

const meta: Meta<typeof Combobox> = {
  title: 'Components/Combobox',
  component: Combobox,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    disabled: { control: 'boolean' },
    error: { control: 'text' },
    restrictToOptions: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Combobox>;

const fontOptions = [
  { value: 'inter', label: 'Inter' },
  { value: 'roboto', label: 'Roboto' },
  { value: 'sf-pro', label: 'SF Pro' },
  { value: 'system-ui', label: 'System UI' },
  { value: 'monospace', label: 'Monospace' },
];

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('inter');
    return <Combobox label="Font family" value={value} onChange={setValue} options={fontOptions} />;
  },
};

export const WithPlaceholder: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <Combobox
        label="Font family"
        value={value}
        onChange={setValue}
        options={fontOptions}
        placeholder="Select a font..."
      />
    );
  },
};

export const RestrictToOptions: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <Combobox
        label="Country"
        value={value}
        onChange={setValue}
        options={fontOptions}
        placeholder="Type to filter..."
        restrictToOptions
      />
    );
  },
};

export const WithError: Story = {
  render: () => {
    const [value, setValue] = useState('custom-font');
    return (
      <Combobox
        label="Font family"
        value={value}
        onChange={setValue}
        options={fontOptions}
        error="Unknown font family"
      />
    );
  },
};

export const Disabled: Story = {
  args: {
    label: 'Font family',
    value: 'inter',
    onChange: () => {},
    options: fontOptions,
    disabled: true,
  },
};

export const Dark: Story = {
  render: () => {
    const [value, setValue] = useState('inter');
    return <Combobox label="Font family" value={value} onChange={setValue} options={fontOptions} />;
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
