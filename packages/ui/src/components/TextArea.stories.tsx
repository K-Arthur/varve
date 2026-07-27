import type { Meta, StoryObj } from '@storybook/react';
import { TextArea } from './TextArea';

const meta: Meta<typeof TextArea> = {
  title: 'Components/TextArea',
  component: TextArea,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
    error: { control: 'text' },
    hint: { control: 'text' },
    maxLength: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof TextArea>;

export const Default: Story = {
  args: { label: 'Bio', placeholder: 'Tell us about yourself...', value: '', onChange: () => {} },
};

export const WithValue: Story = {
  args: { label: 'Description', value: 'This is a sample description text.', onChange: () => {} },
};

export const WithHint: Story = {
  args: { label: 'Comments', value: '', onChange: () => {}, hint: 'Enter your feedback above' },
};

export const WithError: Story = {
  args: {
    label: 'Review',
    value: 'Too short',
    onChange: () => {},
    error: 'Must be at least 50 characters',
  },
};

export const WithMaxLength: Story = {
  args: { label: 'Tweet', value: 'Hello world', onChange: () => {}, maxLength: 280 },
};

export const Disabled: Story = {
  args: { label: 'Notes', value: 'Read-only content', onChange: () => {}, disabled: true },
};

export const Dark: Story = {
  args: { label: 'Bio', placeholder: 'Tell us about yourself...', value: '', onChange: () => {} },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
