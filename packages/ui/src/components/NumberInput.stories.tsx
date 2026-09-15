import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { NumberInput } from './NumberInput';

const meta: Meta<typeof NumberInput> = {
  title: 'Components/NumberInput',
  component: NumberInput,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    min: { control: 'number' },
    max: { control: 'number' },
    step: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof NumberInput>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState(0);
    return <NumberInput label="Opacity" value={value} onChange={setValue} />;
  },
};

export const WithBounds: Story = {
  render: () => {
    const [value, setValue] = useState(50);
    return <NumberInput label="Volume" value={value} min={0} max={100} onChange={setValue} />;
  },
};

export const WithCustomStep: Story = {
  render: () => {
    const [value, setValue] = useState(1.5);
    return (
      <NumberInput
        label="Stroke width"
        value={value}
        step={0.5}
        min={0}
        max={100}
        onChange={setValue}
      />
    );
  },
};

export const Dark: Story = {
  render: () => {
    const [value, setValue] = useState(42);
    return <NumberInput label="Opacity" value={value} onChange={setValue} />;
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
