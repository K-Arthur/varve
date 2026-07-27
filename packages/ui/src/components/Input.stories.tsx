import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './Input';

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
    error: { control: 'text' },
    hint: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { label: 'Name', placeholder: 'Enter your name', value: '', onChange: () => {} },
};

export const WithError: Story = {
  args: { label: 'Email', value: 'invalid', onChange: () => {}, error: 'Invalid email address' },
};

export const WithHint: Story = {
  args: { label: 'Password', value: '', onChange: () => {}, hint: 'At least 8 characters' },
};

export const Disabled: Story = {
  args: { label: 'Username', value: 'johndoe', onChange: () => {}, disabled: true },
};

export const Dark: Story = {
  args: { label: 'Name', placeholder: 'Enter your name', value: '', onChange: () => {} },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
