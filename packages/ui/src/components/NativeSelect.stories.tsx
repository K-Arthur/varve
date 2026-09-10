import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { NativeSelect } from './NativeSelect';

const meta: Meta<typeof NativeSelect> = {
  title: 'Components/NativeSelect',
  component: NativeSelect,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    disabled: { control: 'boolean' },
    error: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof NativeSelect>;

export const PlatformNative: Story = {
  render: () => {
    const [value, setValue] = useState('srgb');
    return (
      <NativeSelect
        label="Colour profile"
        value={value}
        onValueChange={setValue}
        options={[
          { value: 'srgb', label: 'sRGB' },
          { value: 'display-p3', label: 'Display P3' },
        ]}
        description="Uses the operating system's native menu."
      />
    );
  },
};

export const GroupedAndInvalid: Story = {
  args: {
    label: 'Rendering intent',
    defaultValue: '',
    placeholder: 'Choose an intent',
    groups: [
      {
        label: 'Perceptual',
        options: [{ value: 'perceptual', label: 'Perceptual' }],
      },
      {
        label: 'Colorimetric',
        options: [{ value: 'relative', label: 'Relative colorimetric' }],
      },
    ],
    error: 'Select a rendering intent',
  },
};
