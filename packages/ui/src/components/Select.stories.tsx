import type { Meta, StoryObj } from '@storybook/react';
import { type ReactNode, useEffect } from 'react';
import { useState } from 'storybook/preview-api';
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

function ThemeFrame({ theme, children }: { theme: 'dark' | 'high-contrast'; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', theme);
    return () => {
      if (previousTheme) root.setAttribute('data-theme', previousTheme);
      else root.removeAttribute('data-theme');
    };
  }, [theme]);

  return (
    <div style={{ background: 'var(--color-surface-app)', padding: '24px', minHeight: '100px' }}>
      {children}
    </div>
  );
}

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

export const GroupedRichOptions: Story = {
  render: () => {
    const [value, setValue] = useState('native');
    return (
      <Select
        label="Rendering provider"
        value={value}
        onValueChange={setValue}
        groups={[
          {
            label: 'Local',
            options: [
              {
                value: 'native',
                label: 'Native renderer',
                description: 'Fast and available offline',
                icon: 'Gear',
                status: 'success',
              },
              {
                value: 'webgpu',
                label: 'WebGPU renderer',
                description: 'Requires compatible hardware',
                disabled: true,
                disabledReason: 'WebGPU is unavailable in this session',
              },
            ],
          },
          {
            label: 'Compatibility',
            options: [{ value: 'canvas', label: 'Canvas 2D fallback', status: 'info' }],
          },
        ]}
      />
    );
  },
};

export const HelperAndStaleValue: Story = {
  args: {
    label: 'ICC profile',
    value: 'removed-profile',
    options: [{ value: 'srgb', label: 'sRGB IEC61966-2.1' }],
    onChange: () => {},
    description: 'The saved profile is no longer installed.',
  },
};

export const Loading: Story = {
  args: {
    label: 'Model',
    value: '',
    options: [],
    onChange: () => {},
    loading: true,
  },
};

export const NarrowInspector: Story = {
  render: () => {
    const [value, setValue] = useState('long');
    return (
      <div style={{ width: '180px' }}>
        <Select
          label="Long profile name"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'long', label: 'A profile with a long localized name' },
            { value: 'short', label: 'sRGB' },
          ]}
        />
      </div>
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
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
};

export const HighContrast: Story = {
  render: () => {
    const [value, setValue] = useState('option-1');
    return (
      <Select
        options={[
          { value: 'option-1', label: 'Option 1' },
          { value: 'option-2', label: 'Option 2', disabled: true, disabledReason: 'Not available' },
        ]}
        value={value}
        onValueChange={setValue}
        label="High contrast select"
      />
    );
  },
  decorators: [
    (Story) => (
      <ThemeFrame theme="high-contrast">
        <Story />
      </ThemeFrame>
    ),
  ],
};
