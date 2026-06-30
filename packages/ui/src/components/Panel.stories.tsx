import type { Meta, StoryObj } from '@storybook/react';
import { Panel } from './Panel';

const meta: Meta<typeof Panel> = {
  title: 'Components/Panel',
  component: Panel,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    side: { control: 'select', options: ['left', 'right'] },
    defaultWidth: { control: 'number' },
    minWidth: { control: 'number' },
    maxWidth: { control: 'number' },
    collapsed: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Panel>;

export const Default: Story = {
  args: {
    storageKey: 'story-default',
    defaultWidth: 260,
    label: 'Layers panel',
    children: (
      <div style={{ padding: '12px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '14px' }}>Layers</h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          <li style={{ padding: '4px 0' }}>Frame 1</li>
          <li style={{ padding: '4px 0' }}>Rectangle 1</li>
          <li style={{ padding: '4px 0' }}>Text 1</li>
        </ul>
      </div>
    ),
  },
};

export const RightSide: Story = {
  args: {
    storageKey: 'story-right',
    defaultWidth: 240,
    side: 'right',
    label: 'Inspector panel',
    children: (
      <div style={{ padding: '12px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '14px' }}>Inspector</h3>
        <p style={{ fontSize: '13px', margin: 0 }}>Position, size, fill properties.</p>
      </div>
    ),
  },
};

export const Collapsed: Story = {
  args: {
    storageKey: 'story-collapsed',
    defaultWidth: 260,
    collapsed: true,
    label: 'Collapsed panel',
    children: <div style={{ padding: '12px' }}>Hidden content.</div>,
  },
};
