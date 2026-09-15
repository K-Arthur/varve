import type { Meta, StoryObj } from '@storybook/react';
import { Icon } from '../icons';
import { Button } from './Button';
import { ButtonGroup } from './ButtonGroup';
import { CopyButton } from './CopyButton';
import { IconButton } from './IconButton';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link', 'toolbar'],
    },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg'] },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Default', variant: 'default' },
};

export const Secondary: Story = {
  args: { children: 'Secondary', variant: 'secondary' },
};

export const Ghost: Story = {
  args: { children: 'Ghost', variant: 'ghost' },
};

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
};

export const Loading: Story = {
  args: { children: 'Saving...', loading: true },
};

export const Dark: Story = {
  args: { children: 'Primary Dark', variant: 'default' },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};

export const SystemGallery: Story = {
  render: () => (
    <div className="varve-button-gallery">
      <div className="varve-button-gallery__row">
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">Large</Button>
      </div>
      <div className="varve-button-gallery__row">
        <Button variant="default">Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link action</Button>
        <Button variant="toolbar">Toolbar</Button>
      </div>
      <div className="varve-button-gallery__row">
        <Button>
          <span>Leading icon</span>
        </Button>
        <Button>
          <span>Continue</span>
          <Icon name="ArrowRight" />
        </Button>
        <IconButton icon="Settings" label="Settings" size="icon-xs" />
        <IconButton icon="Settings" label="Settings" size="icon-sm" />
        <IconButton icon="Settings" label="Settings" size="icon" />
        <IconButton icon="Settings" label="Settings" size="icon-lg" />
      </div>
      <div className="varve-button-gallery__row">
        <Button disabled>Disabled</Button>
        <Button loading loadingLabel="Saving document">
          Saving
        </Button>
        <CopyButton value="Varve" label="project name" />
      </div>
      <ButtonGroup label="Grouped actions">
        <Button variant="outline">Back</Button>
        <Button variant="outline">Review</Button>
        <Button variant="default">Apply</Button>
      </ButtonGroup>
    </div>
  ),
};
