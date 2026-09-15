import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { Tabs } from './Tabs';

const meta: Meta<typeof Tabs> = {
  title: 'Components/Tabs',
  component: Tabs,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof Tabs>;

const tabs = [
  { value: 'design', label: 'Design' },
  { value: 'prototype', label: 'Prototype' },
  { value: 'code', label: 'Code' },
];

const tabsWithIcons = [
  { value: 'grid', label: 'Grid', icon: 'LayoutGrid' as const },
  { value: 'list', label: 'List', icon: 'List' as const },
  { value: 'settings', label: 'Settings', icon: 'Settings' as const },
];

export const Default: Story = {
  render: () => {
    const [active, setActive] = useState('design');
    return (
      <Tabs label="Workspace tabs" tabs={tabs} activeTab={active} onTabChange={setActive}>
        <div>Design panel content</div>
        <div>Prototype panel content</div>
        <div>Code panel content</div>
      </Tabs>
    );
  },
};

export const WithIcons: Story = {
  render: () => {
    const [active, setActive] = useState('grid');
    return (
      <Tabs label="View tabs" tabs={tabsWithIcons} activeTab={active} onTabChange={setActive}>
        <div>Grid view content</div>
        <div>List view content</div>
        <div>Settings content</div>
      </Tabs>
    );
  },
};

export const Dark: Story = {
  render: () => {
    const [active, setActive] = useState('design');
    return (
      <Tabs label="Workspace tabs" tabs={tabs} activeTab={active} onTabChange={setActive}>
        <div>Design panel content</div>
        <div>Prototype panel content</div>
        <div>Code panel content</div>
      </Tabs>
    );
  },
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '100px' }}>
        <Story />
      </div>
    ),
  ],
};
