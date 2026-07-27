import type { Meta, StoryObj } from '@storybook/react';
import { IconButton } from './IconButton';

const meta: Meta<typeof IconButton> = {
  title: 'Components/IconButton',
  component: IconButton,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    pressed: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {
  args: { icon: 'Settings', label: 'Settings', variant: 'ghost' },
};

export const Primary: Story = {
  args: { icon: 'Plus', label: 'Add', variant: 'primary' },
};

export const Secondary: Story = {
  args: { icon: 'Download', label: 'Download', variant: 'secondary' },
};

export const Danger: Story = {
  args: { icon: 'Trash2', label: 'Delete', variant: 'danger' },
};

export const Pressed: Story = {
  args: { icon: 'Bold', label: 'Bold', variant: 'ghost', pressed: true },
};

export const Disabled: Story = {
  args: { icon: 'Settings', label: 'Settings', variant: 'ghost', disabled: true },
};

export const Dark: Story = {
  args: { icon: 'Settings', label: 'Settings', variant: 'ghost' },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
