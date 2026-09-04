import type { Meta, StoryObj } from '@storybook/react';
import { useRef } from 'react';
import { ScrollArea, ScrollProgress } from './ScrollArea';

const meta: Meta<typeof ScrollArea> = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    orientation: { control: 'select', options: ['vertical', 'horizontal', 'both'] },
  },
};

export default meta;
type Story = StoryObj<typeof ScrollArea>;

export const Vertical: Story = {
  render: (args) => (
    <ScrollArea {...args} style={{ blockSize: 'var(--space-20)' }} viewportProps={{ tabIndex: 0 }}>
      <div style={{ padding: 'var(--space-3)' }}>
        {Array.from({ length: 24 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static gallery rows have no state
          <div key={index} style={{ paddingBlock: 'var(--space-1)' }}>
            Layer {index + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
  args: { orientation: 'vertical' },
};

export const Horizontal: Story = {
  render: (args) => (
    <ScrollArea {...args} style={{ inlineSize: 'var(--space-20)' }}>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          padding: 'var(--space-3)',
          inlineSize: 'max-content',
        }}
      >
        {Array.from({ length: 12 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static gallery items have no state
          <div key={index} style={{ inlineSize: 'var(--space-12)' }}>
            Page {index + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
  args: { orientation: 'horizontal' },
};

export const StickyHeaderWithProgress: Story = {
  render: () => {
    const viewportRef = useRef<HTMLDivElement>(null);
    return (
      <div style={{ blockSize: 'var(--space-20)' }}>
        <ScrollProgress viewportRef={viewportRef} aria-label="Reading progress" />
        <ScrollArea viewportRef={viewportRef} viewportProps={{ tabIndex: 0 }}>
          <div>
            <div
              style={{
                position: 'sticky',
                insetBlockStart: 0,
                padding: 'var(--space-2)',
                background: 'var(--color-surface-raised)',
              }}
            >
              Column labels
            </div>
            {Array.from({ length: 30 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static gallery rows have no state
              <div key={index} style={{ padding: 'var(--space-2)' }}>
                Entry {index + 1}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  },
};
