import { useState } from 'storybook/preview-api';
import type { Meta, StoryObj } from '@storybook/react';
import { Slider } from './Slider';

const meta: Meta<typeof Slider> = {
  title: 'Components/Slider',
  component: Slider,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    min: { control: 'number' },
    max: { control: 'number' },
    step: { control: 'number' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Slider>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState(50);
    return <Slider label="Volume" value={value} min={0} max={100} onChange={setValue} />;
  },
};

export const WithCustomStep: Story = {
  render: () => {
    const [value, setValue] = useState(2);
    return (
      <Slider
        label="Opacity"
        value={value}
        min={0}
        max={10}
        step={0.5}
        onChange={setValue}
        formatValue={(v) => `${v * 10}%`}
      />
    );
  },
};

export const WithFormatValue: Story = {
  render: () => {
    const [value, setValue] = useState(75);
    return (
      <Slider
        label="Brightness"
        value={value}
        min={0}
        max={100}
        onChange={setValue}
        formatValue={(v) => `${v}%`}
      />
    );
  },
};

export const Disabled: Story = {
  args: { label: 'Volume', value: 30, min: 0, max: 100, onChange: () => {}, disabled: true },
};

export const Dark: Story = {
  render: () => {
    const [value, setValue] = useState(50);
    return <Slider label="Volume" value={value} min={0} max={100} onChange={setValue} />;
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
