import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { Switch, SwitchField } from './Switch';

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

export const DisabledChecked: Story = {
  args: { label: 'Enable notifications', checked: true, onChange: () => {}, disabled: true },
};

export const Field: Story = {
  render: () => (
    <SwitchField
      label="GPU acceleration"
      description="Use hardware acceleration where available."
      checked
      onChange={() => {}}
    />
  ),
};

export const Dependent: Story = {
  render: () => (
    <SwitchField
      label="High-quality preview"
      description="Keeps more detail while previewing large documents."
      disabledReason="Enable smart preview first."
      checked
      disabled
    />
  ),
};

export const Gallery: Story = {
  render: function GalleryStory() {
    const [checked, setChecked] = useState(false);
    return (
      <div style={{ display: 'grid', gap: '12px', maxWidth: '360px' }}>
        <Switch
          label="Show guides"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <Switch label="Disabled off" disabled />
        <Switch label="Disabled on" checked disabled />
        <SwitchField
          label="A longer setting label that wraps in a narrow panel"
          description="Supporting copy remains associated with the control and does not push it outside the row."
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
      </div>
    );
  },
};

export const Dark: Story = {
  args: { label: 'Enable notifications', checked: true, onChange: () => {} },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div
        data-theme="dark"
        style={{ background: 'var(--color-surface-app)', padding: '24px', minHeight: '100px' }}
      >
        <Story />
      </div>
    ),
  ],
};
