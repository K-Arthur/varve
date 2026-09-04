import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Input } from './Input';
import { SegmentedControl } from './SegmentedControl';
import { Select } from './Select';

const meta: Meta = {
  title: 'Foundations/Corner radius system',
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj;

function Gallery() {
  const [alignment, setAlignment] = useState('center');
  return (
    <div className="radius-gallery">
      <section className="radius-gallery__section">
        <h2>Controls</h2>
        <div className="radius-gallery__row">
          <Button variant="default">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <IconButton icon="Settings" label="Settings" />
          <IconButton icon="X" label="Close" variant="secondary" />
        </div>
        <div className="radius-gallery__row">
          <Input aria-label="Name" placeholder="Input" />
          <Select
            label="Size"
            value="medium"
            options={[{ value: 'medium', label: 'Medium' }]}
            onChange={() => undefined}
          />
        </div>
        <SegmentedControl
          label="Alignment"
          value={alignment}
          options={[
            { value: 'left', label: 'Left', icon: 'AlignLeft' },
            { value: 'center', label: 'Center', icon: 'AlignCenter' },
            { value: 'right', label: 'Right', icon: 'AlignRight' },
          ]}
          onChange={setAlignment}
        />
      </section>

      <section className="radius-gallery__section">
        <h2>Grouped and floating surfaces</h2>
        <div className="radius-gallery__surface radius-gallery__surface--floating">
          <div className="radius-gallery__group">
            <button type="button" className="varve-btn varve-btn--sm">
              A
            </button>
            <button type="button" className="varve-btn varve-btn--sm">
              B
            </button>
            <button type="button" className="varve-btn varve-btn--sm">
              C
            </button>
          </div>
          <div className="varve-menu radius-gallery__menu">
            <button type="button" className="varve-menu__item">
              Menu item
            </button>
            <button type="button" className="varve-menu__item">
              Another item
            </button>
          </div>
        </div>
        <div className="radius-gallery__surface radius-gallery__surface--card">
          <strong>Card / dialog surface</strong>
          <p>Surface geometry is stronger than control geometry.</p>
        </div>
      </section>
    </div>
  );
}

export const Light: Story = { render: () => <Gallery /> };

export const Dark: Story = {
  render: () => <Gallery />,
  decorators: [
    (Story) => (
      <div data-theme="dark" className="radius-gallery__dark">
        <Story />
      </div>
    ),
  ],
};
