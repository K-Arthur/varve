import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedSeparator, Separator, SeparatorWithContent } from './Separator';

const meta: Meta<typeof Separator> = {
  title: 'Components/Separator',
  component: Separator,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof Separator>;

export const Gallery: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gap: 'var(--space-5)',
        maxWidth: '28rem',
        padding: 'var(--space-5)',
        background: 'var(--color-surface-raised)',
      }}
    >
      <Separator tone="subtle" />
      <Separator tone="strong" />
      <Separator variant="dashed" tone="default" />
      <Separator variant="fade" tone="accent" />
      <SeparatorWithContent align="start">Layers</SeparatorWithContent>
      <SeparatorWithContent align="center">Properties</SeparatorWithContent>
      <SeparatorWithContent align="end">
        Long localized section title that truncates
      </SeparatorWithContent>
      <div
        style={{ display: 'flex', alignItems: 'stretch', gap: 'var(--space-3)', height: '2rem' }}
      >
        <span>Canvas</span>
        <Separator orientation="vertical" tone="subtle" />
        <span>100%</span>
      </div>
      <AnimatedSeparator tone="accent" />
      <div dir="rtl">
        <SeparatorWithContent align="center">RTL stress test</SeparatorWithContent>
      </div>
    </div>
  ),
};
