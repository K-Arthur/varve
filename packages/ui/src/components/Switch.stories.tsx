import type { Meta, StoryObj } from '@storybook/react';
import { Switch } from './Switch';

const meta: Meta<typeof Switch> = {
  title: 'Components/Switch',
  component: Switch,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    disabled: { control: 'boolean' },
    checked: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {
  args: { label: 'Enable notifications', checked: false, onChange: () => {} },
};

export const Checked: Story = {
  args: { label: 'Enable notifications', checked: true, onChange: () => {} },
};

export const Disabled: Story = {
  args: { label: 'Enable notifications', checked: false, onChange: () => {}, disabled: true },
};

export const Dark: Story = {
  args: { label: 'Enable notifications', checked: true, onChange: () => {} },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
