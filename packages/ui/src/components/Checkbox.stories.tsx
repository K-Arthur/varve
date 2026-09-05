import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox } from './Checkbox';

const meta: Meta<typeof Checkbox> = {
  title: 'Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    indeterminate: { control: 'boolean' },
    disabled: { control: 'boolean' },
    checked: { control: 'boolean' },
    label: { control: 'text' },
    description: { control: 'text' },
    error: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  args: { label: 'Accept terms', checked: false, onChange: () => {} },
};

export const Checked: Story = {
  args: { label: 'Accept terms', checked: true, onChange: () => {} },
};

export const Indeterminate: Story = {
  args: { label: 'Select all', indeterminate: true, checked: false, onChange: () => {} },
};

export const Disabled: Story = {
  args: { label: 'Unavailable option', checked: false, disabled: true, onChange: () => {} },
};

export const DisabledChecked: Story = {
  args: { label: 'Locked feature', checked: true, disabled: true, onChange: () => {} },
};

export const WithDescription: Story = {
  args: {
    label: 'Enable analytics',
    description: 'Help us improve the product by sharing usage data.',
    checked: false,
    onChange: () => {},
  },
};

export const WithError: Story = {
  args: {
    label: 'Accept terms',
    error: 'You must accept the terms to continue.',
    checked: false,
    onChange: () => {},
  },
};

export const WithDescriptionAndError: Story = {
  render: () => (
    <Checkbox
      label="Accept terms"
      description="Required for account creation."
      error="You must accept the terms to continue."
      checked={false}
      onChange={() => {}}
    />
  ),
};

export const Dark: Story = {
  args: { label: 'Accept terms', checked: true, onChange: () => {} },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
