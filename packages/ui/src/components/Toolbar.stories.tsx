import type { Meta, StoryObj } from '@storybook/react';
import { IconButton } from './IconButton';
import { Toolbar } from './Toolbar';

const meta: Meta<typeof Toolbar> = {
  title: 'Components/Toolbar',
  component: Toolbar,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof Toolbar>;

export const Default: Story = {
  render: () => (
    <Toolbar label="Formatting toolbar">
      <IconButton icon="Bold" label="Bold" variant="ghost" />
      <IconButton icon="Italic" label="Italic" variant="ghost" />
      <IconButton icon="Underline" label="Underline" variant="ghost" />
      <IconButton icon="AlignLeft" label="Align left" variant="ghost" />
      <IconButton icon="AlignCenter" label="Align center" variant="ghost" />
      <IconButton icon="AlignRight" label="Align right" variant="ghost" />
    </Toolbar>
  ),
};

export const NoWrap: Story = {
  render: () => (
    <Toolbar label="Limited toolbar" wrap={false}>
      <IconButton icon="Bold" label="Bold" variant="ghost" />
      <IconButton icon="Italic" label="Italic" variant="ghost" />
      <IconButton icon="Underline" label="Underline" variant="ghost" />
    </Toolbar>
  ),
};

export const Dark: Story = {
  render: () => (
    <Toolbar label="Formatting toolbar">
      <IconButton icon="Bold" label="Bold" variant="ghost" />
      <IconButton icon="Italic" label="Italic" variant="ghost" />
      <IconButton icon="Underline" label="Underline" variant="ghost" />
    </Toolbar>
  ),
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
