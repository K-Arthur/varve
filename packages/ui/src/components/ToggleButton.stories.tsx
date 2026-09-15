import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { ToggleButton } from './ToggleButton';

const meta: Meta<typeof ToggleButton> = {
  title: 'Components/ToggleButton',
  component: ToggleButton,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof ToggleButton>;

export const Default: Story = {
  render: () => {
    const [pressed, setPressed] = useState(false);
    return <ToggleButton pressed={pressed} onPressedChange={setPressed} icon="Bold" label="Bold" />;
  },
};

export const Pressed: Story = {
  render: () => {
    const [pressed, setPressed] = useState(true);
    return (
      <ToggleButton pressed={pressed} onPressedChange={setPressed} icon="Italic" label="Italic" />
    );
  },
};

export const Disabled: Story = {
  render: () => {
    const [pressed, setPressed] = useState(false);
    return (
      <ToggleButton
        pressed={pressed}
        onPressedChange={setPressed}
        icon="Underline"
        label="Underline"
        disabled
      />
    );
  },
};

export const DisabledPressed: Story = {
  render: () => {
    const [pressed, setPressed] = useState(true);
    return (
      <ToggleButton
        pressed={pressed}
        onPressedChange={setPressed}
        icon="Strikethrough"
        label="Strikethrough"
        disabled
      />
    );
  },
};

export const Dark: Story = {
  render: () => {
    const [pressed, setPressed] = useState(true);
    return <ToggleButton pressed={pressed} onPressedChange={setPressed} icon="Bold" label="Bold" />;
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
