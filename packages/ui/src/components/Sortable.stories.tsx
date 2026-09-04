import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { SOLID_CHROME_ICONS, SolidIcon } from '../icons';
import { Sortable, SortableItem, SortableItemHandle, SortableOverlay } from './Sortable';

const meta: Meta<typeof Sortable> = {
  title: 'Components/Sortable',
  component: Sortable,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof Sortable>;

function HandleOnlyList() {
  const [items, setItems] = useState(['Header', 'Navigation', 'Content', 'Footer']);

  return (
    <Sortable
      items={items}
      onReorder={({ items: next }) => next && setItems(next.map(String))}
      renderOverlay={(id) => <SortableOverlay>{String(id)}</SortableOverlay>}
    >
      <ul
        style={{
          display: 'grid',
          gap: '4px',
          listStyle: 'none',
          margin: 0,
          padding: 0,
          width: 280,
        }}
      >
        {items.map((item) => (
          <SortableItem
            as="li"
            key={item}
            id={item}
            style={{ alignItems: 'center', display: 'flex', gap: 4 }}
          >
            <SortableItemHandle aria-label={`Drag ${item}`}>
              <SolidIcon name={SOLID_CHROME_ICONS.gripVertical} size="0.7em" />
            </SortableItemHandle>
            <button type="button" style={{ flex: 1, textAlign: 'left' }}>
              {item}
            </button>
          </SortableItem>
        ))}
      </ul>
    </Sortable>
  );
}

export const HandleOnly: Story = {
  render: () => <HandleOnlyList />,
};

export const Dark: Story = {
  render: () => <HandleOnlyList />,
  parameters: { themes: { themeOverride: 'dark' } },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ background: '#10151f', minHeight: 260, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
};
