import type { Meta, StoryObj } from '@storybook/react';
import { CopyButton } from './CopyButton';

const meta: Meta<typeof CopyButton> = {
  title: 'Components/CopyButton',
  component: CopyButton,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    value: { control: 'text' },
    label: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof CopyButton>;

export const Default: Story = {
  args: { value: 'Hello, world!', label: 'greeting' },
};

export const Dark: Story = {
  args: { value: 'Sensitive data', label: 'token' },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
