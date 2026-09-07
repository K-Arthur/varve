import type { Meta, StoryObj } from '@storybook/react';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardMedia,
  type CardProps,
  CardTitle,
} from './Card';

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'subtle',
        'outline',
        'surface',
        'interactive',
        'selectable',
        'media',
        'status',
        'prominent',
      ],
    },
    density: { control: 'select', options: ['compact', 'standard'] },
    selected: { control: 'boolean' },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
  args: {
    variant: 'surface',
    density: 'standard',
    selected: false,
    disabled: false,
    loading: false,
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

function PreviewCard(props: CardProps) {
  return (
    <Card {...props} style={{ maxWidth: 360, ...props.style }}>
      <CardMedia
        style={{
          minHeight: 120,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--color-surface-sunken)',
        }}
      >
        <span aria-hidden="true">Varve preview</span>
      </CardMedia>
      <CardHeader>
        <div>
          <CardTitle>Local project</CardTitle>
          <CardDescription>One document, ready to continue.</CardDescription>
        </div>
        <CardAction aria-label="More project actions">•••</CardAction>
      </CardHeader>
      <CardFooter>
        <span style={{ color: 'var(--color-text-muted)' }}>Edited just now</span>
        <span style={{ marginInlineStart: 'auto' }}>Open</span>
      </CardFooter>
    </Card>
  );
}

export const Basic: Story = { render: (args) => <PreviewCard {...args} /> };

export const Selectable: Story = {
  args: { variant: 'selectable', selected: true },
  render: (args) => <PreviewCard {...args} />,
};

export const CompactStatus: Story = {
  args: { variant: 'status', density: 'compact' },
  render: (args) => (
    <Card {...args} style={{ maxWidth: 240, ...args.style }}>
      <CardContent>
        <CardTitle as="h4">Assets indexed</CardTitle>
        <strong style={{ fontSize: 'var(--font-size-xl)' }}>128</strong>
      </CardContent>
    </Card>
  ),
};

export const States: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', maxWidth: 360 }}>
      <PreviewCard variant="interactive" />
      <PreviewCard variant="selectable" selected />
      <PreviewCard variant="surface" disabled />
      <PreviewCard variant="surface" loading />
    </div>
  ),
};
