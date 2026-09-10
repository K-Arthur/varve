import type { Meta, StoryObj } from '@storybook/react';
import { ContentSkeleton } from './ContentSkeleton';

const meta: Meta<typeof ContentSkeleton> = {
  title: 'Components/ContentSkeleton',
  component: ContentSkeleton,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    variant: { control: 'select', options: ['list', 'grid', 'card', 'inline'] },
    rows: { control: 'number' },
    columns: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof ContentSkeleton>;

export const List: Story = {
  args: { label: 'Loading list', variant: 'list', rows: 5 },
};

export const Grid: Story = {
  args: { label: 'Loading grid', variant: 'grid', rows: 3, columns: 4 },
};

export const Card: Story = {
  args: { label: 'Loading card', variant: 'card' },
};

export const Inline: Story = {
  args: { label: 'Loading inline', variant: 'inline', width: '200px', height: '16px' },
};

export const Dark: Story = {
  args: { label: 'Loading list', variant: 'list', rows: 3 },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
