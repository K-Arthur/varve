import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

function DefaultIllustration() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <title>Empty state illustration</title>
      <rect x="8" y="8" width="48" height="48" rx="4" opacity="0.3" />
      <path d="M24 32h16M32 24v16" />
    </svg>
  );
}

export const Default: Story = {
  args: {
    illustration: <DefaultIllustration />,
    headline: 'No layers yet',
    description: 'Add a frame, shape, or text to get started.',
    actions: <Button variant="primary">Add Frame</Button>,
  },
};

export const NoActions: Story = {
  args: {
    illustration: <DefaultIllustration />,
    headline: 'Nothing here',
    description: 'This panel is empty.',
  },
};

export const Dark: Story = {
  args: {
    illustration: <DefaultIllustration />,
    headline: 'No results found',
    description: 'Try adjusting your search or filter criteria.',
  },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px' }}>
        <Story />
      </div>
    ),
  ],
};
