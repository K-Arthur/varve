import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { LoadingLabel } from './LoadingLabel';
import { RegionLoader } from './RegionLoader';
import { Spinner } from './Spinner';
import './Spinner.stories.css';

const meta: Meta<typeof Spinner> = {
  title: 'Components/Loading system',
  component: Spinner,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg'] },
    label: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Sizes: Story = {
  render: () => (
    <div className="loading-story__sizes">
      <span>
        <Spinner size="xs" /> xs
      </span>
      <span>
        <Spinner size="sm" /> sm
      </span>
      <span>
        <Spinner size="md" /> md
      </span>
      <span>
        <Spinner size="lg" /> lg
      </span>
    </div>
  ),
};

export const InlineStatus: Story = {
  render: () => <LoadingLabel label="Preparing export" />,
};

export const ActionStates: Story = {
  render: () => {
    const [loading, setLoading] = useState(true);
    return (
      <div className="loading-story__actions">
        <Button loading={loading} loadingLabel="Saving document">
          Save
        </Button>
        <Button variant="destructive" loading={loading} loadingLabel="Deleting document">
          Delete
        </Button>
        <IconButton icon="RefreshCw" label="Refresh assets" loading={loading} />
        <Button variant="ghost" onClick={() => setLoading((value) => !value)}>
          {loading ? 'Show idle states' : 'Show loading states'}
        </Button>
      </div>
    );
  },
};

export const RegionOverlay: Story = {
  render: () => (
    <div style={{ width: 320, minHeight: 160 }}>
      <RegionLoader loading label="Loading model status" delay={0}>
        <div className="loading-story__panel">
          <strong>Model manager</strong>
          <span>Installed models appear here.</span>
        </div>
      </RegionLoader>
    </div>
  ),
};

export const Dark: Story = {
  render: () => (
    <div data-theme="dark" className="loading-story__dark">
      <LoadingLabel label="Indexing local assets" />
    </div>
  ),
};
