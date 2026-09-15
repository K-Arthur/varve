import type { Meta, StoryObj } from '@storybook/react';
import { Icon, type IconName } from './Icon';

const meta: Meta<typeof Icon> = {
  title: 'Icons/Icon',
  component: Icon,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    name: {
      control: 'select',
      options: [
        'MousePointer2',
        'Square',
        'Circle',
        'Type',
        'Pen',
        'Trash2',
        'Check',
        'X',
        'ChevronDown',
        'Settings',
      ],
    },
    size: { control: 'number' },
    label: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Icon>;

export const Decorative: Story = {
  args: { name: 'Square' },
};

export const Labelled: Story = {
  args: { name: 'Check', label: 'Confirmed' },
};

export const Large: Story = {
  args: { name: 'Settings', size: 48 },
};

export const CustomColor: Story = {
  args: { name: 'Trash2', size: 24, color: '#cd4045' },
};

export const AllIcons: Story = {
  render: () => {
    const iconNames: IconName[] = [
      'MousePointer2',
      'Square',
      'Circle',
      'Type',
      'Pen',
      'Trash2',
      'Check',
      'X',
      'ChevronDown',
      'Settings',
      'Eye',
      'Lock',
      'Search',
      'Plus',
      'ListFilter',
      'Star',
      'Copy',
      'Undo2',
      'Redo2',
    ];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
        {iconNames.map((name) => (
          <div
            key={name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              width: '80px',
            }}
          >
            <Icon name={name} size={24} />
            <span style={{ fontSize: '10px', textAlign: 'center', wordBreak: 'break-all' }}>
              {name}
            </span>
          </div>
        ))}
      </div>
    );
  },
};
